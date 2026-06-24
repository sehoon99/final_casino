import { registerGame } from '../_engine/GameEngine';
import { GameConfig } from '../../../../../config/game-config';
import type { GameEngine, GameState, Player, PlayerAction, Payout } from '../../../../shared/src/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type SlotSymbol = typeof GameConfig.games.slots.symbols[number];

interface SlotsPlayerState {
  bet: number;
  reels: SlotSymbol[] | null; // null = 아직 스핀 전
  ready: boolean;
}

interface SlotsData {
  players: Record<string, SlotsPlayerState>;
  phase: 'betting' | 'payout';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spinReels(numReels: number): SlotSymbol[] {
  const symbols = GameConfig.games.slots.symbols as readonly SlotSymbol[];
  return Array.from({ length: numReels }, () =>
    symbols[Math.floor(Math.random() * symbols.length)],
  );
}

/**
 * 릴 결과에서 가장 많이 등장한 심볼의 연속 개수를 반환한다.
 * "연속"이 아닌 "최다 등장 횟수" 기준으로 계산 (슬롯 일반 규칙).
 */
function countMaxMatch(reels: Symbol[]): number {
  const freq = new Map<Symbol, number>();
  for (const s of reels) freq.set(s, (freq.get(s) ?? 0) + 1);
  return Math.max(...freq.values());
}

function payoutMultiplier(matchCount: number): number {
  const p = GameConfig.games.slots.payouts;
  if (matchCount >= 5) return p.match5;
  if (matchCount === 4) return p.match4;
  if (matchCount === 3) return p.match3;
  if (matchCount === 2) return p.match2;
  return -1; // 1개 이하: 베팅 전액 손실
}

// ─── Game Engine ──────────────────────────────────────────────────────────────

const SlotsEngine: GameEngine = {
  id: 'slots',
  name: 'Slots',
  minPlayers: 1,
  maxPlayers: 8,

  initialize(players: Player[]): GameState {
    const playerStates: Record<string, SlotsPlayerState> = {};
    for (const p of players) {
      playerStates[p.id] = { bet: 0, reels: null, ready: false };
    }

    const data: SlotsData = {
      players: playerStates,
      phase: 'betting',
    };

    return {
      gameId: 'slots',
      roomId: '',
      players: players.map(p => p.id),
      status: 'in_progress',
      round: 1,
      data: data as unknown as Record<string, unknown>,
    };
  },

  processAction(state: GameState, action: PlayerAction): GameState {
    const data = state.data as unknown as SlotsData;
    const ps = data.players[action.playerId];
    if (!ps) return state;

    switch (action.type) {
      /**
       * SPIN: 베팅 금액을 설정하고 즉시 릴을 돌린다.
       * payload: number (베팅 금액)
       * 베팅 단계에서 아직 스핀하지 않은 플레이어만 가능.
       */
      case 'SPIN': {
        if (data.phase !== 'betting' || ps.ready) return state;

        const amount = action.payload as number;
        const cfg = GameConfig.games.slots;
        if (amount < cfg.minBet || amount > cfg.maxBet) return state;

        ps.bet = amount;
        ps.reels = spinReels(cfg.reels);
        ps.ready = true;

        // 모든 플레이어가 스핀을 마치면 페이아웃 단계로 전환
        const allReady = Object.values(data.players).every(p => p.ready);
        if (allReady) data.phase = 'payout';
        break;
      }
    }

    return { ...state, data: data as unknown as Record<string, unknown> };
  },

  isRoundOver(state: GameState): boolean {
    const data = state.data as unknown as SlotsData;
    return data.phase === 'payout';
  },

  calculatePayouts(state: GameState): Payout[] {
    const data = state.data as unknown as SlotsData;
    const payouts: Payout[] = [];

    for (const [playerId, ps] of Object.entries(data.players)) {
      if (!ps.reels || ps.bet === 0) {
        payouts.push({ playerId, amount: 0 });
        continue;
      }

      const match = countMaxMatch(ps.reels);
      const multiplier = payoutMultiplier(match);

      // multiplier > 0: 순이익, multiplier === -1: 베팅 전액 손실
      const amount = multiplier >= 0
        ? Math.floor(ps.bet * multiplier)
        : -ps.bet;

      payouts.push({ playerId, amount });
    }

    return payouts;
  },
};

registerGame(SlotsEngine);
export default SlotsEngine;
