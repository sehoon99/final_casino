import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './db';
import { publishEvent } from './events';
import { GameConfig } from '../../../../config/game-config';
import type { RoomMeta, RoomPlayer } from './types';

const HEADERS = { 'Content-Type': 'application/json' };

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const roomId = event.pathParameters?.roomId;
    const body = JSON.parse(event.body ?? '{}') as { userId?: string; userName?: string };
    const { userId, userName } = body;

    if (!roomId || !userId || !userName) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'roomId, userId, userName required' }) };
    }

    // Preflight read — better error messages before the transact write
    const metaRes = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { pk: `ROOM#${roomId}`, sk: 'META' },
    }));
    const meta = metaRes.Item as RoomMeta | undefined;

    if (!meta) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Room not found' }) };
    }
    if (meta.status !== 'waiting') {
      return { statusCode: 409, headers: HEADERS, body: JSON.stringify({ error: 'Room is not accepting players' }) };
    }
    if (meta.playerCount >= meta.maxPlayers) {
      return { statusCode: 409, headers: HEADERS, body: JSON.stringify({ error: 'Room is full' }) };
    }

    const now = Date.now();
    const player: RoomPlayer = {
      pk: `ROOM#${roomId}`,
      sk: `PLAYER#${userId}`,
      roomId,
      userId,
      name: userName,
      balance: GameConfig.room.startingBalance,
      status: 'active',
      currentGameId: null,
      lastActionAt: now,
      joinedAt: now,
    };

    // Atomic: add player + increment count, guarded by room capacity + status conditions
    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: player,
            // Reject if player already joined
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
        {
          Update: {
            TableName: TABLE,
            Key: { pk: `ROOM#${roomId}`, sk: 'META' },
            UpdateExpression: 'SET playerCount = playerCount + :one',
            // Guard against race: another request filled the last slot between our read and this write
            ConditionExpression: 'playerCount < maxPlayers AND #s = :waiting',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':one': 1, ':waiting': 'waiting' },
          },
        },
      ],
    }));

    await publishEvent('PLAYER_JOINED', { roomId, userId });

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        roomId,
        userId,
        balance: GameConfig.room.startingBalance,
      }),
    };
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'TransactionCanceledException') {
      return { statusCode: 409, headers: HEADERS, body: JSON.stringify({ error: 'Room is full or already joined' }) };
    }
    console.error('[join-room]', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
