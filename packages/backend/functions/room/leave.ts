import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './db';
import { deleteRoom } from './cleanup';
import { publishEvent } from './events';
import type { RoomMeta, RoomPlayer } from './types';

const HEADERS = { 'Content-Type': 'application/json' };

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const roomId = event.pathParameters?.roomId;
    const body = JSON.parse(event.body ?? '{}') as { userId?: string };
    const { userId } = body;

    if (!roomId || !userId) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'roomId and userId required' }) };
    }

    const [metaRes, playerRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: 'META' } })),
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: `PLAYER#${userId}` } })),
    ]);

    const meta = metaRes.Item as RoomMeta | undefined;
    const player = playerRes.Item as RoomPlayer | undefined;

    if (!meta || !player) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Room or player not found' }) };
    }

    if (meta.status === 'in_progress') {
      // 게임 중 나가기 → 몰수패 처리 (레코드는 유지, 관전 전환)
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `ROOM#${roomId}`, sk: `PLAYER#${userId}` },
        UpdateExpression: 'SET #s = :bankrupt, balance = :zero',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':bankrupt': 'bankrupt', ':zero': 0 },
      }));
      await publishEvent('PLAYER_BANKRUPT', { roomId, userId, reason: 'left_game' });
    } else {
      if (meta.playerCount <= 1) {
        // 마지막 플레이어 퇴장 → 방 전체 삭제
        await deleteRoom(roomId);
        await publishEvent('ROOM_CLOSED', { roomId, userId, reason: 'empty' });
      } else {
        // 다른 플레이어가 남아있는 경우 — 레코드 삭제 + playerCount 감소
        const metaUpdateExpr = meta.hostId === userId
          ? 'SET playerCount = playerCount - :one, #s = :finished'
          : 'SET playerCount = playerCount - :one';
        const metaExprValues: Record<string, unknown> = { ':one': 1, ':zero': 0 };
        if (meta.hostId === userId) metaExprValues[':finished'] = 'finished';

        await ddb.send(new TransactWriteCommand({
          TransactItems: [
            { Delete: { TableName: TABLE, Key: { pk: `ROOM#${roomId}`, sk: `PLAYER#${userId}` } } },
            {
              Update: {
                TableName: TABLE,
                Key: { pk: `ROOM#${roomId}`, sk: 'META' },
                UpdateExpression: metaUpdateExpr,
                ConditionExpression: 'playerCount > :zero',
                ...(meta.hostId === userId ? { ExpressionAttributeNames: { '#s': 'status' } } : {}),
                ExpressionAttributeValues: metaExprValues,
              },
            },
          ],
        }));
        await publishEvent('PLAYER_LEFT', { roomId, userId, wasHost: meta.hostId === userId });
      }
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ roomId, userId }),
    };
  } catch (err) {
    console.error('[leave-room]', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
