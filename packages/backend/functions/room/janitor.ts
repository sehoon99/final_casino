import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { ddb, TABLE } from './db';
import { deleteRoom } from './cleanup';

const INACTIVITY_MS = 30 * 60 * 1000; // 30분

export const handler = async (): Promise<void> => {
  const now = Date.now();
  const cutoff = now - INACTIVITY_MS;

  // Scan META records only
  const scan = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'sk = :meta AND begins_with(pk, :rpfx)',
    ExpressionAttributeValues: { ':meta': 'META', ':rpfx': 'ROOM#' },
    ProjectionExpression: 'pk, lastActivityAt, createdAt',
  }));

  const stale: string[] = [];
  for (const item of scan.Items ?? []) {
    const lastActivity = (item.lastActivityAt ?? item.createdAt ?? 0) as number;
    if (lastActivity < cutoff) {
      stale.push((item.pk as string).slice(5)); // roomId
    }
  }

  if (stale.length === 0) return;
  console.log(`[janitor] 비활성 방 ${stale.length}개 삭제: ${stale.join(', ')}`);

  const wsUrl = process.env.WS_CALLBACK_URL;
  await Promise.all(stale.map(async roomId => {
    // 연결 중인 플레이어에게 ROOM_CLOSED 전송
    if (wsUrl) {
      try {
        const conns = await ddb.send(new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pfx)',
          ExpressionAttributeValues: { ':pk': `ROOM#${roomId}`, ':pfx': 'CONN#' },
        }));
        const api = new ApiGatewayManagementApiClient({ endpoint: wsUrl });
        const msg = Buffer.from(JSON.stringify({ type: 'ROOM_CLOSED', reason: 'inactivity' }));
        await Promise.allSettled(
          (conns.Items ?? []).map(c =>
            api.send(new PostToConnectionCommand({ ConnectionId: c.connectionId as string, Data: msg }))
          )
        );
      } catch {}
    }
    await deleteRoom(roomId);
  }));
};
