import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from '../room/db';
import { broadcastToRoom, sendToConnection } from './broadcast';
import { getGame } from '../games/_engine/GameEngine';
import { logger } from '../logger';
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
    ConsistentRead: true,  // $connect 직후 메시지 도착 시 eventual consistency 방지
  }));
  const conn = connRes.Item as ConnMeta | undefined;
  if (!conn) {
    logger.warn('연결 메타 없음 — 401 반환', { connId: connectionId });
    return { statusCode: 401 };
  }

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
    case 'GET_ROOM_STATE': {
      // 클라이언트가 연결 직후 명시적으로 방 상태를 요청할 때 사용 (ROOM_STATE 수신 실패 fallback)
      const [gsPlayersRes, gsMetaRes, gsGameRes] = await Promise.all([
        ddb.send(new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': `ROOM#${conn.roomId}`, ':prefix': 'PLAYER#' },
          ConsistentRead: true,
        })),
        ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${conn.roomId}`, sk: 'META' }, ConsistentRead: true })),
        ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${conn.roomId}`, sk: 'GAME#current' } })),
      ]);
      const gsMeta = gsMetaRes.Item as { hostId: string } | undefined;
      const gsGame = gsGameRes.Item as { gameId: string; state: unknown } | undefined;
      const gsPlayers = (gsPlayersRes.Items ?? []).map(item => ({
        userId:  item.userId as string,
        name:    item.name as string,
        balance: item.balance as number,
        status:  item.status as string,
        ready:   (item.ready as boolean) ?? false,
      }));
      await sendToConnection(connectionId, {
        type: 'ROOM_STATE',
        players: gsPlayers,
        hostId:  gsMeta?.hostId ?? null,
        gameId:  gsGame?.gameId ?? null,
        gameState: (gsGame?.state && Object.keys(gsGame.state as object).length > 0) ? gsGame.state : null,
        isReconnect: false,
      }, callbackUrl, conn.roomId);
      break;
    }

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

      // 방장 확인
      const metaForStart = await ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { pk: `ROOM#${conn.roomId}`, sk: 'META' },
        ConsistentRead: true,
      }));
      if (!metaForStart.Item || metaForStart.Item.hostId !== conn.userId) {
        logger.warn('START_GAME 권한 없음', { userId: conn.userId, roomId: conn.roomId, action: 'START_GAME', hostId: metaForStart.Item?.hostId });
        await sendToConnection(connectionId, { type: 'ERROR', message: '방장만 게임을 시작할 수 있습니다' }, callbackUrl);
        break;
      }

      const engine = getGame(gameId as never);
      const playersRes = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': `ROOM#${conn.roomId}`, ':prefix': 'PLAYER#' },
        ConsistentRead: true,
      }));
      const activePlayers = (playersRes.Items ?? []).filter(p => p.status === 'active');

      // 방장 혼자가 아닐 때 모든 플레이어 준비 확인
      const nonHost = activePlayers.filter(p => p.userId !== conn.userId);
      if (nonHost.length > 0 && nonHost.some(p => !p.ready)) {
        logger.warn('START_GAME 준비 미완료', { userId: conn.userId, roomId: conn.roomId, action: 'START_GAME', notReadyCount: nonHost.filter(p => !p.ready).length });
        await sendToConnection(connectionId, { type: 'ERROR', message: '모든 플레이어가 준비를 완료해야 합니다' }, callbackUrl);
        break;
      }
      if (activePlayers.length < 1) {
        await sendToConnection(connectionId, { type: 'ERROR', message: '플레이어가 없습니다' }, callbackUrl);
        break;
      }

      const players: Player[] = activePlayers.map((item) => ({
        id:            item.userId as string,
        name:          item.name as string,
        balance:       item.balance as number,
        status:        (item.status as Player['status']) ?? 'active',
        currentGameId: (item.currentGameId as Player['currentGameId']) ?? null,
        lastActionAt:  (item.lastActionAt as number) ?? Date.now(),
      }));

      const state = engine.initialize(players, {});
      state.roomId = conn.roomId;

      logger.info('게임 시작', { userId: conn.userId, roomId: conn.roomId, action: 'START_GAME', gameId, playerCount: activePlayers.length });
      logger.metric('game_start', { userId: conn.userId, roomId: conn.roomId, gameId, playerCount: activePlayers.length });

      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: { pk: `ROOM#${conn.roomId}`, sk: 'GAME#current', gameId, state },
      }));
      await broadcastToRoom(conn.roomId, { type: 'GAME_STARTED', gameId, state }, callbackUrl);
      break;
    }

    case 'SET_READY': {
      const { ready } = msg.payload as { ready: boolean };
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `ROOM#${conn.roomId}`, sk: `PLAYER#${conn.userId}` },
        UpdateExpression: 'SET ready = :r',
        ExpressionAttributeValues: { ':r': ready },
      }));
      await broadcastToRoom(conn.roomId, {
        type: 'PLAYER_READY',
        userId: conn.userId,
        ready,
      }, callbackUrl);
      break;
    }

    case 'TRANSFER_HOST': {
      const { targetUserId } = msg.payload as { targetUserId: string };
      const metaForTransfer = await ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { pk: `ROOM#${conn.roomId}`, sk: 'META' },
      }));
      if (!metaForTransfer.Item || metaForTransfer.Item.hostId !== conn.userId) {
        await sendToConnection(connectionId, { type: 'ERROR', message: '방장만 인계할 수 있습니다' }, callbackUrl);
        break;
      }
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `ROOM#${conn.roomId}`, sk: 'META' },
        UpdateExpression: 'SET hostId = :h',
        ExpressionAttributeValues: { ':h': targetUserId },
      }));
      await broadcastToRoom(conn.roomId, {
        type: 'HOST_TRANSFERRED',
        fromUserId: conn.userId,
        toUserId: targetUserId,
      }, callbackUrl);
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
          logger.info('라운드 종료', { userId: conn.userId, roomId: conn.roomId, gameId: record.gameId });
          logger.metric('game_end', { userId: conn.userId, roomId: conn.roomId, gameId: record.gameId });
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
        logger.error('GAME_ACTION 처리 실패', { userId: conn.userId, roomId: conn.roomId, action: 'GAME_ACTION' }, err);
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
