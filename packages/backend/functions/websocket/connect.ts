import { TransactWriteCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from '../room/db';
import { broadcastToRoom, sendToConnection } from './broadcast';
import type { WsHandler } from './types';

export const handler: WsHandler = async (event) => {
  const { connectionId, domainName, stage } = event.requestContext;
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

  // Check reconnect status + fetch room snapshot in parallel
  const [playerRes, playersRes, gameRes, metaRes] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: `PLAYER#${userId}` } })),
    ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': `ROOM#${roomId}`, ':prefix': 'PLAYER#' },
    })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: 'GAME#current' } })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: 'META' } })),
  ]);

  // Room no longer exists — clean up the CONN# records we just created and notify client
  if (!metaRes.Item) {
    await Promise.allSettled([
      ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: `CONN#${connectionId}` } })),
      ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `CONNECTION#${connectionId}`, sk: 'META' } })),
    ]);
    await sendToConnection(connectionId, { type: 'ROOM_CLOSED', reason: 'not_found' }, callbackUrl);
    return { statusCode: 200 };
  }

  const isReconnect = playerRes.Item?.status === 'disconnected';

  if (isReconnect) {
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
  }));

  const gameRecord = gameRes.Item as { gameId: string; state: unknown } | undefined;
  const gameState  = gameRecord?.state ?? null;

  // Send current room snapshot to the connecting player
  await sendToConnection(connectionId, {
    type: 'ROOM_STATE',
    players,
    gameId:    gameRecord?.gameId ?? null,
    gameState: (gameState && Object.keys(gameState as object).length > 0) ? gameState : null,
    isReconnect,
  }, callbackUrl);

  return { statusCode: 200 };
};
