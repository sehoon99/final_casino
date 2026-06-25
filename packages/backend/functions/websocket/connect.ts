import { TransactWriteCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from '../room/db';
import { broadcastToRoom, sendToConnection } from './broadcast';
import { logger, fetchGeo } from '../logger';
import type { WsHandler } from './types';

export const handler: WsHandler = async (event) => {
  const { connectionId, domainName, stage } = event.requestContext;
  const sourceIp = event.requestContext.identity?.sourceIp;
  const { userId, roomId, userName } = event.queryStringParameters ?? {};

  if (!userId || !roomId) return { statusCode: 400 };

  const callbackUrl = process.env.USE_LOCAL_WS
    ? 'http://localhost:3001'
    : `https://${domainName}/${stage}`;

  const now = Date.now();
  const ttl = Math.floor(now / 1000) + 86_400;

  // Update room activity timestamp (connection = activity)
  ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: `ROOM#${roomId}`, sk: 'META' },
    UpdateExpression: 'SET lastActivityAt = :now',
    ExpressionAttributeValues: { ':now': now },
  })).catch(() => {});

  // Store connection metadata
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE,
          Item: {
            pk: `CONNECTION#${connectionId}`, sk: 'META',
            connectionId, userId, roomId,
            userName: userName ?? userId,
            connectedAt: now, ttl,
          },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: { pk: `ROOM#${roomId}`, sk: `CONN#${connectionId}`, connectionId, userId, ttl },
        },
      },
    ],
  }));

  // Check reconnect status + fetch room snapshot + IP geo lookup in parallel
  const [playerRes, playersRes, gameRes, metaRes, geo] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: `PLAYER#${userId}` } })),
    ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': `ROOM#${roomId}`, ':prefix': 'PLAYER#' },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: 'GAME#current' } })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: 'META' }, ConsistentRead: true })),
    fetchGeo(sourceIp),
  ]);

  // Room no longer exists — clean up the CONN# records we just created and notify client
  if (!metaRes.Item) {
    logger.warn('META 없는 방 접속 시도', { userId, roomId, connId: connectionId });
    await Promise.allSettled([
      ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: `CONN#${connectionId}` } })),
      ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `CONNECTION#${connectionId}`, sk: 'META' } })),
    ]);
    await sendToConnection(connectionId, { type: 'ROOM_CLOSED', reason: 'not_found' }, callbackUrl);
    return { statusCode: 200 };
  }

  const isReconnect = playerRes.Item?.status === 'disconnected';

  const geoCtx = geo ? { country: geo.country, countryCode: geo.countryCode, timezone: geo.timezone } : {};

  if (isReconnect) {
    logger.info('플레이어 재접속', { userId, roomId, connId: connectionId, ...geoCtx });
    logger.metric('session_reconnect', { userId, roomId, ...geoCtx });
    // Restore player status and cancel the 60-second TTL kick timer
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `ROOM#${roomId}`, sk: `PLAYER#${userId}` },
      UpdateExpression: 'SET #s = :active, #ttl = :ttl REMOVE disconnectedAt',
      ExpressionAttributeNames: { '#s': 'status', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':active': 'active', ':ttl': Math.floor(Date.now() / 1000) + 86_400 },
    }));
    await broadcastToRoom(
      roomId,
      { type: 'PLAYER_RECONNECTED', userId, userName: userName ?? userId },
      callbackUrl,
      connectionId,
    );
  } else {
    logger.info('플레이어 입장', { userId, roomId, connId: connectionId, playerCount: (playersRes.Items?.length ?? 0), ...geoCtx });
    logger.metric('session_start', { userId, roomId, sourceIp, ...geoCtx });
    // New player joined — notify existing players
    const balance = playerRes.Item?.balance as number | undefined ?? 10000;
    await broadcastToRoom(
      roomId,
      { type: 'PLAYER_JOINED', userId, userName: userName ?? userId, balance },
      callbackUrl,
      connectionId,
    );
  }

  // Build player list (reflect reconnect status immediately)
  const players = (playersRes.Items ?? []).map(item => ({
    userId:  item.userId as string,
    name:    item.name as string,
    balance: item.balance as number,
    status:  (isReconnect && item.userId === userId) ? 'active' : (item.status as string),
    ready:   (item.ready as boolean) ?? false,
  }));

  const meta = metaRes.Item as { hostId: string } | undefined;
  const gameRecord = gameRes.Item as { gameId: string; state: unknown } | undefined;
  const gameState  = gameRecord?.state ?? null;

  const roomSnapshot = {
    type: 'ROOM_STATE' as const,
    players,
    hostId:    meta?.hostId ?? null,
    gameId:    gameRecord?.gameId ?? null,
    gameState: (gameState && Object.keys(gameState as object).length > 0) ? gameState : null,
  };

  // 기존 플레이어에게도 최신 플레이어 목록을 브로드캐스트 (신규 접속자 포함)
  await broadcastToRoom(roomId, { ...roomSnapshot, isReconnect: false }, callbackUrl, connectionId);

  // 신규 접속자에게 현재 방 스냅샷 전송
  await sendToConnection(connectionId, { ...roomSnapshot, isReconnect }, callbackUrl, roomId);

  return { statusCode: 200 };
};
