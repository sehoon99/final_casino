import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './db';
import { deleteRoom } from './cleanup';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Token check (case-insensitive header key due to API Gateway v2 lowercasing)
  const token = _event.headers?.['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
    const items = res.Items ?? [];

    // Group by room
    const rooms: Record<string, {
      meta: Record<string, unknown> | null;
      players: Record<string, unknown>[];
      connections: string[];
      game: Record<string, unknown> | null;
    }> = {};

    for (const item of items) {
      const pk: string = item.pk;
      const sk: string = item.sk;

      if (!pk.startsWith('ROOM#')) continue;
      const roomId = pk.slice(5);

      if (!rooms[roomId]) {
        rooms[roomId] = { meta: null, players: [], connections: [], game: null };
      }

      if (sk === 'META') {
        rooms[roomId].meta = item;
      } else if (sk.startsWith('PLAYER#')) {
        rooms[roomId].players.push(item);
      } else if (sk.startsWith('CONN#')) {
        rooms[roomId].connections.push(sk.slice(5));
      } else if (sk === 'GAME#current') {
        rooms[roomId].game = item;
      }
    }

    // Clean up zombie rooms
    const now = Date.now();
    const zombieIds: string[] = [];
    for (const [roomId, r] of Object.entries(rooms)) {
      // META 없는 방 = 반쯤 삭제된 유령 방 → 즉시 정리
      if (!r.meta) {
        zombieIds.push(roomId);
        continue;
      }
      if (r.connections.length > 0) continue;
      if (r.game != null) continue; // active game — skip
      const ageMs = r.meta?.createdAt ? now - Number(r.meta.createdAt) : 0;
      if (ageMs < 2 * 60 * 1000) continue; // too young — might be reconnecting
      const allDisconnected = r.players.every(p => p.status === 'disconnected' || p.status === 'bankrupt');
      if (r.players.length === 0 || allDisconnected) {
        zombieIds.push(roomId);
      }
    }
    if (zombieIds.length > 0) {
      await Promise.all(zombieIds.map(id => deleteRoom(id).catch(() => {})));
      for (const id of zombieIds) delete rooms[id];
    }

    const result = Object.entries(rooms).map(([roomId, r]) => ({
      roomId,
      hostId:      r.meta?.hostId,
      status:      r.meta?.status,
      maxPlayers:  r.meta?.maxPlayers,
      playerCount: r.players.length,
      connCount:   r.connections.length,
      createdAt:   r.meta?.createdAt,
      ageMinutes:  r.meta?.createdAt ? Math.floor((now - Number(r.meta.createdAt)) / 60000) : null,
      gameActive:  r.game?.state != null,
      gameId:      r.game?.gameId ?? null,
      players: r.players.map(p => ({
        userId:   p.userId,
        name:     p.name,
        balance:  p.balance,
        status:   p.status,
        joinedAt: p.joinedAt,
      })),
      connections: r.connections,
    }));

    result.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        rooms: result,
        scannedAt: now,
        cleaned: zombieIds.length,
      }),
    };
  } catch (err) {
    console.error('[admin]', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
