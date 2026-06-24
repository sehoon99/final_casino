import { registerGame } from '../_engine/GameEngine';
import { GameConfig } from '../../../../../config/game-config';
import type { GameEngine, GameState, Player, PlayerAction, Payout } from '../../../../shared/src/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

interface Card {
  suit: Suit;
  rank: Rank;
}

/** 플레이어가 배팅할 수 있는 세 가지 결과 */
type BetTarget = 'player' | 'banker' | 'tie';

interface BaccaratPlayerState {
  betTarget: BetTarget | null;
  betAmount: number;
  ready: boolean;
}

interface BaccaratData {
  deck: Card[];
  playerHand: Card[];
  bankerHand: Card[];
  players: Record<string, BaccaratPlayerState>;
  phase: 'betting' | 'dealing' | 'payout';
  /** payout 단계에서 확정된 결과 */
  outcome: BetTarget | null; // 'player' | 'banker' | 'tie'
}

// ─── Card Helpers ─────────────────────────────────────────────────────────────

/** 바카라 카드 값: A=1, 2–9=액면가, 10/J/Q/K=0 */
const BACCARAT_VALUES: Record<Rank, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5,
  '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 0, J: 0, Q: 0, K: 0,
};

function buildDeck(numDecks: number): Card[] {
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
  const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank });
      }
    }
  }
  return shuffle(deck);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 핸드 합산: 10 이상은 일의 자리만 사용 */
function handValue(hand: Card[]): number {
  const total = hand.reduce((sum, c) => sum + BACCARAT_VALUES[c.rank], 0);
  return total % 10;
}

/** 내추럴 여부: 첫 2장 합이 8 또는 9 */
function isNatural(hand: Card[]): boolean {
  return hand.length === 2 && (handValue(hand) === 8 || handValue(hand) === 9);
}

// ─── Third-Card Rules ─────────────────────────────────────────────────────────

/**
 * 플레이어 세 번째 카드 규칙
 * - 합계 0–5: 드로우
 * - 합계 6–7: 스탠드
 * (내추럴인 경우 이 함수는 호출되지 않음)
 */
function playerDrawsThird(playerValue: number): boolean {
  return playerValue <= 5;
}

/**
 * 뱅커 세 번째 카드 규칙 (플레이어 세 번째 카드 여부에 따라 달라짐)
 * playerThirdCard: 플레이어가 세 번째 카드를 뽑은 경우 그 카드 값, 뽑지 않은 경우 null
 */
function bankerDrawsThird(bankerValue: number, playerThirdCard: number | null): boolean {
  if (playerThirdCard === null) {
    // 플레이어가 스탠드한 경우: 뱅커는 0–5면 드로우
    return bankerValue <= 5;
  }
  // 플레이어가 세 번째 카드를 뽑은 경우: 뱅커 드로우 테이블
  if (bankerValue <= 2) return true;
  if (bankerValue === 3) return playerThirdCard !== 8;
  if (bankerValue === 4) return playerThirdCard >= 2 && playerThirdCard <= 7;
  if (bankerValue === 5) return playerThirdCard >= 4 && playerThirdCard <= 7;
  if (bankerValue === 6) return playerThirdCard === 6 || playerThirdCard === 7;
  return false; // bankerValue >= 7: 스탠드
}

// ─── Deal Logic ───────────────────────────────────────────────────────────────

/**
 * 초기 2장 딜 후 필요 시 세 번째 카드까지 처리하여
 * playerHand / bankerHand를 완성한다.
 */
function dealRound(deck: Card[]): { playerHand: Card[]; bankerHand: Card[] } {
  // 초기 2장씩 딜 (교대 순서: P, B, P, B)
  const playerHand: Card[] = [deck.pop()!, deck.pop()!];
  const bankerHand: Card[] = [deck.pop()!, deck.pop()!];

  // 내추럴이면 즉시 종료
  if (isNatural(playerHand) || isNatural(bankerHand)) {
    return { playerHand, bankerHand };
  }

  // 플레이어 세 번째 카드
  let playerThirdCardValue: number | null = null;
  if (playerDrawsThird(handValue(playerHand))) {
    const third = deck.pop()!;
    playerHand.push(third);
    playerThirdCardValue = BACCARAT_VALUES[third.rank];
  }

  // 뱅커 세 번째 카드
  if (bankerDrawsThird(handValue(bankerHand), playerThirdCardValue)) {
    bankerHand.push(deck.pop()!);
  }

  return { playerHand, bankerHand };
}

// ─── Outcome ──────────────────────────────────────────────────────────────────

function resolveOutcome(playerHand: Card[], bankerHand: Card[]): BetTarget {
  const pv = handValue(playerHand);
  const bv = handValue(bankerHand);
  if (pv > bv) return 'player';
  if (bv > pv) return 'banker';
  return 'tie';
}

// ─── Game Engine ──────────────────────────────────────────────────────────────

const BaccaratEngine: GameEngine = {
  id: 'baccarat',
  name: 'Baccarat',
  minPlayers: 1,
  maxPlayers: 8,

  initialize(players: Player[]): GameState {
    const cfg = GameConfig.games.baccarat;
    const playerStates: Record<string, BaccaratPlayerState> = {};
    for (const p of players) {
      playerStates[p.id] = { betTarget: null, betAmount: 0, ready: false };
    }

    const data: BaccaratData = {
      deck: buildDeck(cfg.decks),
      playerHand: [],
      bankerHand: [],
      players: playerStates,
      phase: 'betting',
      outcome: null,
    };

    return {
      gameId: 'baccarat',
      roomId: '',
      players: players.map(p => p.id),
      status: 'in_progress',
      round: 1,
      data: data as unknown as Record<string, unknown>,
    };
  },

  processAction(state: GameState, action: PlayerAction): GameState {
    const data = state.data as unknown as BaccaratData;
    const ps = data.players[action.playerId];
    if (!ps) return state;

    switch (action.type) {
      /**
       * BET: 베팅 대상 및 금액 설정
       * payload: { target: BetTarget; amount: number }
       * 베팅 단계에서 ready 전에만 변경 가능
       */
      case 'BET': {
        if (data.phase !== 'betting' || ps.ready) return state;

        const { target, amount } = action.payload as { target: BetTarget; amount: number };
        const cfg = GameConfig.games.baccarat;

        if (!['player', 'banker', 'tie'].includes(target)) return state;
        if (amount < cfg.minBet || amount > cfg.maxBet) return state;

        ps.betTarget = target;
        ps.betAmount = amount;
        break;
      }

      /**
       * READY: 베팅 확정
       * 베팅이 설정된 상태에서만 ready 가능
       * 모든 플레이어가 ready이면 자동으로 딜 진행
       */
      case 'READY': {
        if (data.phase !== 'betting' || ps.ready) return state;
        if (ps.betTarget === null || ps.betAmount === 0) return state;

        ps.ready = true;

        const allReady = Object.values(data.players).every(p => p.ready);
        if (allReady) {
          data.phase = 'dealing';
          const { playerHand, bankerHand } = dealRound(data.deck);
          data.playerHand = playerHand;
          data.bankerHand = bankerHand;
          data.outcome = resolveOutcome(playerHand, bankerHand);
          data.phase = 'payout';
        }
        break;
      }
    }

    return { ...state, data: data as unknown as Record<string, unknown> };
  },

  isRoundOver(state: GameState): boolean {
    const data = state.data as unknown as BaccaratData;
    return data.phase === 'payout';
  },

  calculatePayouts(state: GameState): Payout[] {
    const data = state.data as unknown as BaccaratData;
    if (data.outcome === null) return [];

    const cfg = GameConfig.games.baccarat;
    const outcome = data.outcome;
    const payouts: Payout[] = [];

    for (const [playerId, ps] of Object.entries(data.players)) {
      if (ps.betTarget === null || ps.betAmount === 0) {
        payouts.push({ playerId, amount: 0 });
        continue;
      }

      if (ps.betTarget === outcome) {
        // 적중: 베팅 대상별 배당률 적용
        const multiplier = cfg.payouts[ps.betTarget]; // player=1, banker=0.95, tie=8
        const winnings = Math.floor(ps.betAmount * multiplier);
        payouts.push({ playerId, amount: winnings });
      } else if (ps.betTarget === 'tie' && outcome !== 'tie') {
        // 타이에 베팅했지만 타이가 아닌 경우: 베팅금 손실
        payouts.push({ playerId, amount: -ps.betAmount });
      } else if (outcome === 'tie' && ps.betTarget !== 'tie') {
        // 타이 결과지만 플레이어/뱅커에 베팅한 경우: 푸시 (원금 반환, net=0)
        payouts.push({ playerId, amount: 0 });
      } else {
        // 베팅 대상 미적중
        payouts.push({ playerId, amount: -ps.betAmount });
      }
    }

    return payouts;
  },
};

registerGame(BaccaratEngine);
export default BaccaratEngine;
