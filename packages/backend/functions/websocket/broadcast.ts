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
    const name = (err as { name?: string }).name;
    if (name === 'GoneException') {
      await Promise.all([
        ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `CONNECTION#${connectionId}`, sk: 'META' } })),
        roomId
          ? ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: `CONN#${connectionId}` } }))
          : Promise.resolve(),
      ]);
    } else {
      // 403/410 외 오류 — 권한 문제, callbackUrl 오류 등을 감지할 수 있도록 로그 출력
      console.error('[broadcast] postToOne failed', { connectionId, roomId, callbackUrl, error: name, msg: String(err) });
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
  roomId = '',
): Promise<void> {
  const data = Buffer.from(JSON.stringify(payload));
  await postToOne(connectionId, roomId, data, callbackUrl);
}
