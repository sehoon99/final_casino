import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from '../room/db';

type LocalWs = { send(d: string): void; readyState: number };

async function postToOne(
  connectionId: string,
  roomId: string,
  data: Buffer,
  callbackUrl: string,
): Promise<void> {
  if (process.env.USE_LOCAL_WS) {
    const registry = (global as Record<string, unknown>).__localWsConnections as Map<string, LocalWs> | undefined;
    const ws = registry?.get(connectionId);
    if (ws?.readyState === 1) ws.send(data.toString());
    return;
  }

  const api = new ApiGatewayManagementApiClient({ endpoint: callbackUrl });
  try {
    await api.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
  } catch (err) {
    if ((err as { name?: string }).name === 'GoneException') {
      await Promise.all([
        ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `CONNECTION#${connectionId}`, sk: 'META' } })),
        ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: `CONN#${connectionId}` } })),
      ]);
    }
  }
}

export async function broadcastToRoom(
  roomId: string,
  payload: unknown,
  callbackUrl: string,
  excludeConnectionId?: string,
): Promise<void> {
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':pk': `ROOM#${roomId}`, ':prefix': 'CONN#' },
  }));

  const connections = (res.Items ?? []) as { connectionId: string }[];
  if (connections.length === 0) return;

  const data = Buffer.from(JSON.stringify(payload));
  await Promise.allSettled(
    connections
      .filter(({ connectionId }) => connectionId !== excludeConnectionId)
      .map(({ connectionId }) => postToOne(connectionId, roomId, data, callbackUrl)),
  );
}

export async function sendToConnection(
  connectionId: string,
  payload: unknown,
  callbackUrl: string,
): Promise<void> {
  const data = Buffer.from(JSON.stringify(payload));
  await postToOne(connectionId, '', data, callbackUrl);
}
