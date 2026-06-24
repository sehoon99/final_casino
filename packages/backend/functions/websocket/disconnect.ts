import { GetCommand, DeleteCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from '../room/db';
import { deleteRoom } from '../room/cleanup';
import { broadcastToRoom } from './broadcast';
import type { WsHandler } from './types';

export const handler: WsHandler = async (event) => {
  const { connectionId, domainName, stage } = event.requestContext;
  const callbackUrl = process.env.USE_LOCAL_WS
    ? 'http://localhost:3001'
    : `https://${domainName}/${stage}`;

  const res = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { pk: `CONNECTION#${connectionId}`, sk: 'META' },
  }));

  const conn = res.Item as { roomId: string; userId: string; userName: string } | undefined;
  if (!conn) return { statusCode: 200 };

  const { roomId, userId, userName } = conn;

  // Remove connection records
  await Promise.all([
    ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `CONNECTION#${connectionId}`, sk: 'META' } })),
    ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: `CONN#${connectionId}` } })),
  ]);

  // Mark player as disconnected + 60s TTL fallback
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: `ROOM#${roomId}`, sk: `PLAYER#${userId}` },
    UpdateExpression: 'SET #s = :disc, disconnectedAt = :now, #ttl = :ttl',
    ExpressionAttributeNames: { '#s': 'status', '#ttl': 'ttl' },
    ExpressionAttributeValues: {
      ':disc': 'disconnected',
      ':now':  Date.now(),
      ':ttl':  Math.floor(Date.now() / 1000) + 60,
    },
  })).catch(() => {});

  // Notify remaining players before potentially cleaning up
  await broadcastToRoom(roomId, { type: 'PLAYER_DISCONNECTED', userId, userName }, callbackUrl);

  // Count remaining WebSocket connections
  const countConns = async () => {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pfx)',
      ExpressionAttributeValues: { ':pk': `ROOM#${roomId}`, ':pfx': 'CONN#' },
      Select: 'COUNT',
    }));
    return r.Count ?? 0;
  };

  if (await countConns() === 0) {
    // 10-second grace period — allow players to reconnect
    await new Promise(r => setTimeout(r, 10_000));

    if (await countConns() === 0) {
      await deleteRoom(roomId);
    }
  }

  return { statusCode: 200 };
};
