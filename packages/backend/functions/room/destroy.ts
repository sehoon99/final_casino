import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { ddb, TABLE } from './db';
import { deleteRoom } from './cleanup';

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const token = event.headers?.['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const roomId = event.pathParameters?.roomId;
  if (!roomId) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'roomId required' }) };
  }

  const wsUrl = process.env.WS_CALLBACK_URL!;

  // 연결된 플레이어에게 강제 퇴장 메시지 전송 후 WebSocket 강제 종료
  const connItems: { connectionId: string }[] = [];
  try {
    const conns = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pfx)',
      ExpressionAttributeValues: { ':pk': `ROOM#${roomId}`, ':pfx': 'CONN#' },
    }));
    const api = new ApiGatewayManagementApiClient({ endpoint: wsUrl });
    const msgBuf = Buffer.from(JSON.stringify({ type: 'ROOM_CLOSED', reason: 'admin' }));
    const items = (conns.Items ?? []) as { connectionId: string }[];
    items.forEach(c => connItems.push(c));
    await Promise.allSettled(
      items.map(c =>
        api.send(new PostToConnectionCommand({ ConnectionId: c.connectionId, Data: msgBuf }))
      )
    );
  } catch {}

  await deleteRoom(roomId);

  // ROOM_CLOSED 수신 후 클라이언트가 자발적으로 끊지 않을 경우 강제 종료
  if (connItems.length > 0) {
    const api = new ApiGatewayManagementApiClient({ endpoint: wsUrl });
    await Promise.allSettled(
      connItems.map(c =>
        api.send(new DeleteConnectionCommand({ ConnectionId: c.connectionId }))
      )
    );
  }
  console.log(`[destroy] Admin deleted room: ${roomId}`);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ roomId, deleted: true }),
  };
};
