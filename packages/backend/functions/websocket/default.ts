import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from '../room/db';
import { broadcastToRoom, sendToConnection } from './broadcast';
import { getGame } from '../games/_engine/GameEngine';
import type { GameState, Player, Payout } from '../../../shared/src/types';
import type { WsHandler } from './types';

// Register all games at Lambda cold start
import '../games/blackjack/index';
import '../games/roulette/index';
import '../games/baccarat/index';
import '../games/slots/index';
import '../games/hi-lo/index';
import '../games/war/index';

interface ConnMeta { userId: string; roomId: string; userName: string }
interface GameRecord { gameId: string; state: GameState }
interface InMessage { action: string; payload?: unknown }

export const handler: WsHandler = async (event) => {
  const { connectionId, domainName, stage } = event.requestContext;
  const callbackUrl = process.env.USE_LOCAL_WS
    ? 'http://localhost:3001'
    : `https://${domainName}/${stage}`;

  const connRes = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { pk: `CONNECTION#${connectionId}`, sk: 'META' },
  }));
  const conn = connRes.Item as ConnMeta | undefined;
  if (!conn) return { statusCode: 401 };

  const msg = JSON.parse(event.body ?? '{}') as InMessage;

  // Record activity on META — PING is a heartbeat, not real activity
  const activityUpdate = msg.action !== 'PING'
    ? ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `ROOM#${conn.roomId}`, sk: 'META' },
        UpdateExpression: 'SET lastActivityAt = :now',
        ExpressionAttributeValues: { ':now': Date.now() },
      })).catch(() => {})
    : Promise.resolve();

  switch (msg.action) {
    case 'PING': {
      await sendToConnection(connectionId, { type: 'PONG' }, callbackUrl);
      break;
    }

    case 'CHAT': {
      await broadcastToRoom(conn.roomId, {
        type: 'CHAT',
        userId: conn.userId,
        userName: conn.userName,
        message: msg.payload,
      }, callbackUrl);
      break;
    }

    case 'START_GAME': {
      const { gameId } = msg.payload as { gameId: string };
      const engine = getGame(gameId as never);

      // Fetch all active players in the room
      const playersRes = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': `ROOM#${conn.roomId}`, ':prefix': 'PLAYER#' },
      }));
      // RoomPlayer uses `userId`, but GameEngine expects `id` — map explicitly
      const players: Player[] = (playersRes.Items ?? []).map((item) => ({
        id:            item.userId as string,
        name:          item.name as string,
        balance:       item.balance as number,
        status:        (item.status as Player['status']) ?? 'active',
        currentGameId: (item.currentGameId as Player['currentGameId']) ?? null,
        lastActionAt:  (item.lastActionAt as number) ?? Date.now(),
      }));
      if (players.length < engine.minPlayers) {
        await sendToConnection(connectionId, { type: 'ERROR', message: 'Not enough players' }, callbackUrl);
        break;
      }

      const state = engine.initialize(players, {});
      state.roomId = conn.roomId;

      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: { pk: `ROOM#${conn.roomId}`, sk: 'GAME#current', gameId, state },
      }));

      await broadcastToRoom(conn.roomId, { type: 'GAME_STARTED', gameId, state }, callbackUrl);
      break;
    }

    case 'GAME_ACTION': {
      try {
        const gameRes = await ddb.send(new GetCommand({
          TableName: TABLE,
          Key: { pk: `ROOM#${conn.roomId}`, sk: 'GAME#current' },
          ConsistentRead: true,  // 게임 상태는 강일관 읽기 필수 (stale read 방지)
        }));
        const record = gameRes.Item as GameRecord | undefined;
        if (!record || !record.state) {
          await sendToConnection(connectionId, { type: 'ERROR', message: 'No active game' }, callbackUrl);
          break;
        }

        const engine = getGame(record.gameId as never);
        const actionType = (msg.payload as { type: string }).type;
        const playersBefore = Object.entries((record.state.data as Record<string, Record<string, unknown>>).players ?? {})
          .map(([k, v]) => `${k}:${v.status}`).join(', ');
        console.log(`[GAME_ACTION] ${conn.userId} → ${actionType} | players: ${playersBefore}`);

        const newState = engine.processAction(record.state, {
          playerId: conn.userId,
          type: actionType,
          payload: (msg.payload as { payload?: unknown }).payload,
        });
        const playersAfter = Object.entries((newState.data as Record<string, Record<string, unknown>>).players ?? {})
          .map(([k, v]) => `${k}:${v.status}`).join(', ');
        const phase = (newState.data as Record<string, unknown>).phase;
        console.log(`[GAME_ACTION] result: phase=${phase} | players: ${playersAfter} | isOver=${engine.isRoundOver(newState)}`);

        if (engine.isRoundOver(newState)) {
          const payouts = engine.calculatePayouts(newState);
          console.log('[ROUND_OVER] payouts:', JSON.stringify(payouts));
          await applyPayouts(conn.roomId, payouts);
          await broadcastToRoom(conn.roomId, { type: 'ROUND_OVER', payouts, state: newState }, callbackUrl);
          await ddb.send(new PutCommand({
            TableName: TABLE,
            Item: { pk: `ROOM#${conn.roomId}`, sk: 'GAME#current', gameId: record.gameId, state: null },
          }));
        } else {
          await ddb.send(new PutCommand({
            TableName: TABLE,
            Item: { pk: `ROOM#${conn.roomId}`, sk: 'GAME#current', ...record, state: newState },
          }));
          await broadcastToRoom(conn.roomId, { type: 'GAME_STATE', state: newState }, callbackUrl);
        }
      } catch (err) {
        console.error('[GAME_ACTION] error:', err);
        await sendToConnection(connectionId, { type: 'ERROR', message: String(err) }, callbackUrl);
      }
      break;
    }
  }

  await activityUpdate;
  return { statusCode: 200 };
};

async function applyPayouts(roomId: string, payouts: Payout[]): Promise<void> {
  await Promise.all(payouts.map(({ playerId, amount }) =>
    ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `ROOM#${roomId}`, sk: `PLAYER#${playerId}` },
      UpdateExpression: 'SET balance = balance + :amt, lastActionAt = :now',
      ExpressionAttributeValues: { ':amt': amount, ':now': Date.now() },
    })),
  ));
}
