import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './db';
import { publishEvent } from './events';
import { logger } from '../logger';
import { GameConfig } from '../../../../config/game-config';
import type { RoomMeta, RoomPlayer } from './types';

const HEADERS = { 'Content-Type': 'application/json' };

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body ?? '{}') as {
      hostId?: string;
      hostName?: string;
      maxPlayers?: number;
    };

    const { hostId, hostName, maxPlayers = GameConfig.room.maxPlayers } = body;

    if (!hostId || !hostName) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'hostId and hostName required' }) };
    }
    if (maxPlayers < GameConfig.room.minPlayers || maxPlayers > GameConfig.room.maxPlayers) {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({
          error: `maxPlayers must be between ${GameConfig.room.minPlayers} and ${GameConfig.room.maxPlayers}`,
        }),
      };
    }

    const roomId = crypto.randomUUID();
    const now = Date.now();

    const roomMeta: RoomMeta = {
      pk: `ROOM#${roomId}`,
      sk: 'META',
      roomId,
      hostId,
      status: 'waiting',
      maxPlayers,
      playerCount: 1,
      createdAt: now,
    };

    const hostPlayer: RoomPlayer = {
      pk: `ROOM#${roomId}`,
      sk: `PLAYER#${hostId}`,
      roomId,
      userId: hostId,
      name: hostName,
      balance: GameConfig.room.startingBalance,
      status: 'active',
      currentGameId: null,
      lastActionAt: now,
      joinedAt: now,
    };

    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: TABLE, Item: roomMeta } },
        { Put: { TableName: TABLE, Item: hostPlayer } },
      ],
    }));

    logger.metric('room_create', { userId: hostId, roomId, playerCount: maxPlayers });
    await publishEvent('ROOM_CREATED', { roomId, hostId });

    return {
      statusCode: 201,
      headers: HEADERS,
      body: JSON.stringify({ roomId }),
    };
  } catch (err) {
    console.error('[create-room]', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
