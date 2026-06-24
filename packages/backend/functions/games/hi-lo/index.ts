import { registerGame } from '../_engine/GameEngine';
import { GameConfig } from '../../../../../config/game-config';
import type { GameEngine, GameState, Player, PlayerAction, Payout } from '../../../../shared/src/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
type Prediction = 'higher' | 'lower' | 'equal';

interface Card {
  suit: Suit;
  rank: Rank;
}

interface HiLoPlayerState {
  bet: number;
  /** 현재 보여진 카드 */
  currentCard: Card | null;
  /** 플레이어의 예측 */
  prediction: Prediction | null;
  /** 맞춘 연속 횟수 */
  streak: number;
  /** 이번 라운드에서 연속 예측을 계속할지, 아니면 정산할지 선택 */
  status: 'betting' | 'predicting' | 'cashing_out' | 'done' | 'failed';
  /** 이번 라운드 누적 수익 배수 (연속 성공 시 복리로 증가) */
  multiplierAccum: number;
}

interface HiLoData {
  deck: Card[];
  players: Record<string, HiLoPlayerState>;
  phase: 'betting' | 'playing' | 'payout';
}

// ─── Card Helpers ─────────────────────────────────────────────────────────────

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A=1, 2–10=액면가, J=11, Q=12, K=13 */
const RANK_VALUE: Record<Rank, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
  '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13,
};

function buildDeck(numDecks: number): Card[] {
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
  const deck: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const rank of RANKS) {
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

function cardValue(card: Card): number {
  return RANK_VALUE[card.rank];
}

function checkPrediction(current: Card, next: Card, prediction: Prediction): boolean {
  const cv = cardValue(current);
  const nv = cardValue(next);
  if (prediction === 'higher') return nv > cv;
  if (prediction === 'lower')  return nv < cv;
  return nv === cv; // 'equal'
}

// ─── Game Engine ──────────────────────────────────────────────────────────────

const HiLoEngine: GameEngine = {
  id: 'hiLo',
  name: 'Hi-Lo',
  minPlayers: 1,
  maxPlayers: 8,

  initialize(players: Player[]): GameState {
    const cfg = GameConfig.games.hiLo;
    const deck = buildDeck(cfg.decks);
    const playerStates: Record<string, HiLoPlayerState> = {};

    for (const p of players) {
      playerStates[p.id] = {
        bet: 0,
        currentCard: null,
        prediction: null,
        streak: 0,
        status: 'betting',
        multiplierAccum: 1,
      };
    }

    return {
      gameId: 'hiLo',
      roomId: '',
      players: players.map(p => p.id),
      status: 'in_progress',
      round: 1,
      data: { deck, players: playerStates, phase: 'betting' } as unknown as Record<string, unknown>,
    };
  },

  processAction(state: GameState, action: PlayerAction): GameState {
    const data = state.data as unknown as HiLoData;
    const ps = data.players[action.playerId];
    if (!ps) return state;

    switch (action.type) {
      /**
       * BET: 베팅 금액 설정 + 첫 번째 카드 공개
       * payload: number (베팅 금액)
       */
      case 'BET': {
        if (ps.status !== 'betting') return state;

        const amount = action.payload as number;
        const cfg = GameConfig.games.hiLo;
        if (amount < cfg.minBet || amount > cfg.maxBet) return state;

        ps.bet = amount;
        ps.currentCard = data.deck.pop()!;
        ps.status = 'predicting';

        // 모든 플레이어가 베팅을 완료하면 playing 단계로 전환
        const allBet = Object.values(data.players).every(p => p.status !== 'betting');
        if (allBet) data.phase = 'playing';
        break;
      }

      /**
       * PREDICT: higher / lower / equal 예측 후 다음 카드 공개
       * payload: Prediction
       * 성공 시 streak + 1, multiplierAccum 누적
       * 실패 시 status = 'failed' (베팅금 전액 손실)
       * maxStreak 도달 시 자동 cash_out
       */
      case 'PREDICT': {
        if (ps.status !== 'predicting') return state;

        const prediction = action.payload as Prediction;
        if (!['higher', 'lower', 'equal'].includes(prediction)) return state;

        const nextCard = data.deck.pop()!;
        const correct = checkPrediction(ps.currentCard!, nextCard, prediction);

        if (!correct) {
          ps.status = 'failed';
          break;
        }

        ps.streak += 1;
        // 성공마다 배당 배수 누적: 매 성공 +1배씩 추가 (1 → 2 → 3 → ...)
        ps.multiplierAccum = 1 + ps.streak * GameConfig.games.hiLo.payouts.correct;
        ps.currentCard = nextCard;
        ps.prediction = prediction;

        if (ps.streak >= GameConfig.games.hiLo.maxStreak) {
          // 최대 연속 횟수 달성 → 자동 정산
          ps.status = 'cashing_out';
        }
        break;
      }

      /**
       * CASH_OUT: 현재 누적 배당으로 정산하고 라운드 종료
       * predicting 상태에서만 가능 (streak >= 1)
       */
      case 'CASH_OUT': {
        if (ps.status !== 'predicting' || ps.streak === 0) return state;
        ps.status = 'cashing_out';
        break;
      }
    }

    // 모든 플레이어가 done / failed / cashing_out 이면 payout 단계로
    const allDone = Object.values(data.players).every(
      p => p.status === 'done' || p.status === 'failed' || p.status === 'cashing_out',
    );
    if (allDone && data.phase === 'playing') {
      data.phase = 'payout';
    }

    return { ...state, data: data as unknown as Record<string, unknown> };
  },

  isRoundOver(state: GameState): boolean {
    const data = state.data as unknown as HiLoData;
    return data.phase === 'payout';
  },

  calculatePayouts(state: GameState): Payout[] {
    const data = state.data as unknown as HiLoData;
    const payouts: Payout[] = [];

    for (const [playerId, ps] of Object.entries(data.players)) {
      if (ps.status === 'failed') {
        // 예측 실패 → 베팅 전액 손실
        payouts.push({ playerId, amount: -ps.bet });
      } else if (ps.status === 'cashing_out' && ps.streak > 0) {
        // 연속 성공 후 정산 → 누적 배수 × 베팅금 순이익
        const winnings = Math.floor(ps.bet * ps.multiplierAccum);
        payouts.push({ playerId, amount: winnings });
      } else {
        // 베팅 없이 라운드 종료
        payouts.push({ playerId, amount: 0 });
      }
    }

    return payouts;
  },
};

registerGame(HiLoEngine);
export default HiLoEngine;
