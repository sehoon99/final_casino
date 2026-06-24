import { registerGame } from '../_engine/GameEngine';
import { GameConfig } from '../../../../../config/game-config';
import type { GameEngine, GameState, Player, PlayerAction, Payout } from '../../../../shared/src/types';

// ─── Bet Types ────────────────────────────────────────────────────────────────

/** 유럽식 룰렛: 0~36 */
type RouletteNumber = number; // 0–36

type BetType =
  | 'straight'   // 단일 숫자 (35:1)
  | 'split'      // 인접한 2개 숫자 (17:1)
  | 'street'     // 가로 3개 숫자 (11:1)
  | 'corner'     // 사각형 4개 숫자 (8:1)
  | 'sixLine'    // 인접한 2줄 6개 숫자 (5:1)
  | 'column'     // 열 (1st/2nd/3rd) (2:1)
  | 'dozen'      // 다즌 (1st/2nd/3rd) (2:1)
  | 'red'        // 빨강 (1:1)
  | 'black'      // 검정 (1:1)
  | 'even'       // 짝수 (1:1)
  | 'odd'        // 홀수 (1:1)
  | 'low'        // 1–18 (1:1)
  | 'high';      // 19–36 (1:1)

interface RouletteBet {
  type: BetType;
  /** 베팅 대상 숫자 목록 (straight=[3], split=[3,6], street=[4,5,6], ...) */
  numbers: RouletteNumber[];
  amount: number;
}

interface RoulettePlayerState {
  bets: RouletteBet[];
  /** 베팅 제출 완료 여부 */
  ready: boolean;
}

interface RouletteData {
  players: Record<string, RoulettePlayerState>;
  phase: 'betting' | 'spinning' | 'payout';
  /** 스핀 결과 (spinning/payout 단계에서만 존재) */
  result: RouletteNumber | null;
}

// ─── Roulette Constants ───────────────────────────────────────────────────────

/** 유럽식 룰렛 레이아웃의 빨간 숫자 */
const RED_NUMBERS = new Set<RouletteNumber>([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

/** 컬럼별 숫자 목록 (열 1: 1,4,7,...; 열 2: 2,5,8,...; 열 3: 3,6,9,...) */
const COLUMNS: Record<1 | 2 | 3, Set<RouletteNumber>> = {
  1: new Set([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]),
  2: new Set([2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35]),
  3: new Set([3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]),
};

/** 다즌별 숫자 범위 */
const DOZENS: Record<1 | 2 | 3, [number, number]> = {
  1: [1, 12],
  2: [13, 24],
  3: [25, 36],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spinWheel(): RouletteNumber {
  return Math.floor(Math.random() * 37) as RouletteNumber; // 0–36
}

/**
 * 베팅이 결과 숫자에 적중했는지 판정
 */
function isBetWin(bet: RouletteBet, result: RouletteNumber): boolean {
  switch (bet.type) {
    case 'straight':
      return bet.numbers[0] === result;

    case 'split':
    case 'street':
    case 'corner':
    case 'sixLine':
      return bet.numbers.includes(result);

    case 'column': {
      const col = bet.numbers[0] as 1 | 2 | 3;
      return COLUMNS[col].has(result);
    }

    case 'dozen': {
      const d = bet.numbers[0] as 1 | 2 | 3;
      const [lo, hi] = DOZENS[d];
      return result >= lo && result <= hi;
    }

    case 'red':
      return RED_NUMBERS.has(result);

    case 'black':
      return result !== 0 && !RED_NUMBERS.has(result);

    case 'even':
      return result !== 0 && result % 2 === 0;

    case 'odd':
      return result !== 0 && result % 2 !== 0;

    case 'low':
      return result >= 1 && result <= 18;

    case 'high':
      return result >= 19 && result <= 36;

    default:
      return false;
  }
}

/**
 * 베팅 타입별 배당률 (순이익 배수, 원금 별도 반환)
 */
function payoutMultiplier(type: BetType): number {
  const p = GameConfig.games.roulette.payouts;
  switch (type) {
    case 'straight': return p.straight;
    case 'split':    return p.split;
    case 'street':   return p.street;
    case 'corner':   return p.corner;
    case 'sixLine':  return p.sixLine;
    case 'column':   return p.column;
    case 'dozen':    return p.dozen;
    default:         return p.evenMoney; // red/black/even/odd/low/high
  }
}

/**
 * 베팅 유효성 검사
 * - 금액 범위, numbers 배열 길이, 숫자 범위(0~36) 확인
 */
function isValidBet(bet: RouletteBet): boolean {
  const cfg = GameConfig.games.roulette;
  if (bet.amount < cfg.minBet || bet.amount > cfg.maxBet) return false;

  const expectedLengths: Record<BetType, number | null> = {
    straight: 1, split: 2, street: 3, corner: 4, sixLine: 6,
    column: 1, dozen: 1,
    red: 0, black: 0, even: 0, odd: 0, low: 0, high: 0,
  };

  const expected = expectedLengths[bet.type];
  if (expected !== null && bet.numbers.length !== expected) return false;

  // column / dozen 값 범위 체크
  if (bet.type === 'column' && ![1, 2, 3].includes(bet.numbers[0])) return false;
  if (bet.type === 'dozen'  && ![1, 2, 3].includes(bet.numbers[0])) return false;

  // 숫자 범위 체크 (0–36)
  if (['straight', 'split', 'street', 'corner', 'sixLine'].includes(bet.type)) {
    if (bet.numbers.some(n => n < 0 || n > 36)) return false;
  }

  return true;
}

// ─── Game Engine ──────────────────────────────────────────────────────────────

const RouletteEngine: GameEngine = {
  id: 'roulette',
  name: 'Roulette',
  minPlayers: 1,
  maxPlayers: 8,

  initialize(players: Player[]): GameState {
    const playerStates: Record<string, RoulettePlayerState> = {};
    for (const p of players) {
      playerStates[p.id] = { bets: [], ready: false };
    }

    const data: RouletteData = {
      players: playerStates,
      phase: 'betting',
      result: null,
    };

    return {
      gameId: 'roulette',
      roomId: '',
      players: players.map(p => p.id),
      status: 'in_progress',
      round: 1,
      data: data as unknown as Record<string, unknown>,
    };
  },

  processAction(state: GameState, action: PlayerAction): GameState {
    const data = state.data as unknown as RouletteData;
    const playerState = data.players[action.playerId];
    if (!playerState) return state;

    switch (action.type) {
      /**
       * BET: 베팅 추가
       * payload: RouletteBet | RouletteBet[]
       * 베팅 단계에서만 허용, ready 상태가 아닌 플레이어만 가능
       */
      case 'BET': {
        if (data.phase !== 'betting' || playerState.ready) return state;

        const incoming = Array.isArray(action.payload)
          ? (action.payload as RouletteBet[])
          : [action.payload as RouletteBet];

        const validBets = incoming.filter(isValidBet);
        if (validBets.length === 0) return state;

        playerState.bets.push(...validBets);
        break;
      }

      /**
       * CLEAR_BETS: 베팅 초기화
       * 베팅 단계, ready 전에만 허용
       */
      case 'CLEAR_BETS': {
        if (data.phase !== 'betting' || playerState.ready) return state;
        playerState.bets = [];
        break;
      }

      /**
       * READY: 베팅 확정
       * 베팅이 1개 이상 있어야 ready 가능
       * 모든 플레이어가 ready이면 자동으로 스핀
       */
      case 'READY': {
        if (data.phase !== 'betting' || playerState.ready) return state;
        if (playerState.bets.length === 0) return state;

        playerState.ready = true;

        const allReady = Object.values(data.players).every(p => p.ready);
        if (allReady) {
          data.phase = 'spinning';
          data.result = spinWheel();
          data.phase = 'payout';
        }
        break;
      }
    }

    return { ...state, data: data as unknown as Record<string, unknown> };
  },

  isRoundOver(state: GameState): boolean {
    const data = state.data as unknown as RouletteData;
    return data.phase === 'payout';
  },

  calculatePayouts(state: GameState): Payout[] {
    const data = state.data as unknown as RouletteData;
    if (data.result === null) return [];

    const result = data.result;
    const payouts: Payout[] = [];

    for (const [playerId, playerState] of Object.entries(data.players)) {
      let net = 0;

      for (const bet of playerState.bets) {
        if (isBetWin(bet, result)) {
          // 순이익 = 배당률 × 베팅금액, 원금은 그대로 돌려받음 (net = +winnings)
          net += bet.amount * payoutMultiplier(bet.type);
        } else {
          // 패배 시 베팅금액 차감
          net -= bet.amount;
        }
      }

      payouts.push({ playerId, amount: net });
    }

    return payouts;
  },
};

registerGame(RouletteEngine);
export default RouletteEngine;
