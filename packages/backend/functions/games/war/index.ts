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

/**
 * 타이(무승부) 발생 후 플레이어의 선택
 * - 'war': 전쟁 — 동일 금액을 추가 베팅하고 재승부
 * - 'surrender': 포기 — 원래 베팅의 절반 손실 후 라운드 종료
 */
type WarDecision = 'war' | 'surrender';

interface WarPlayerState {
  bet: number;
  playerCard: Card | null;
  dealerCard: Card | null;
  status:
    | 'betting'       // 베팅 대기
    | 'initial_dealt' // 첫 카드 공개 (타이 여부 확인 전)
    | 'tie_pending'   // 타이 발생 — war/surrender 선택 대기
    | 'war_dealt'     // 전쟁 재승부 카드 공개
    | 'done';         // 라운드 종료
  /** 타이 발생 시 war 재승부의 결과 카드 */
  warPlayerCard: Card | null;
  warDealerCard: Card | null;
  decision: WarDecision | null;
}

interface WarData {
  deck: Card[];
  players: Record<string, WarPlayerState>;
  phase: 'betting' | 'playing' | 'payout';
}

// ─── Card Helpers ─────────────────────────────────────────────────────────────

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** 2가 최저, A가 최고 */
const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
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

// ─── Game Engine ──────────────────────────────────────────────────────────────

const WarEngine: GameEngine = {
  id: 'war',
  name: 'War',
  minPlayers: 1,
  maxPlayers: 8,

  initialize(players: Player[]): GameState {
    const cfg = GameConfig.games.war;
    const playerStates: Record<string, WarPlayerState> = {};

    for (const p of players) {
      playerStates[p.id] = {
        bet: 0,
        playerCard: null,
        dealerCard: null,
        status: 'betting',
        warPlayerCard: null,
        warDealerCard: null,
        decision: null,
      };
    }

    return {
      gameId: 'war',
      roomId: '',
      players: players.map(p => p.id),
      status: 'in_progress',
      round: 1,
      data: {
        deck: buildDeck(cfg.decks),
        players: playerStates,
        phase: 'betting',
      } as unknown as Record<string, unknown>,
    };
  },

  processAction(state: GameState, action: PlayerAction): GameState {
    const data = state.data as unknown as WarData;
    const ps = data.players[action.playerId];
    if (!ps) return state;

    switch (action.type) {
      /**
       * BET: 베팅 금액 설정 후 플레이어·딜러에게 카드 1장씩 공개
       * payload: number (베팅 금액)
       */
      case 'BET': {
        if (ps.status !== 'betting') return state;

        const amount = action.payload as number;
        const cfg = GameConfig.games.war;
        if (amount < cfg.minBet || amount > cfg.maxBet) return state;

        ps.bet = amount;
        ps.playerCard = data.deck.pop()!;
        ps.dealerCard = data.deck.pop()!;

        const pv = cardValue(ps.playerCard);
        const dv = cardValue(ps.dealerCard);

        if (pv === dv) {
          ps.status = 'tie_pending'; // 타이 → 결정 대기
        } else {
          ps.status = 'done'; // 즉시 승패 확정
        }

        // 모든 플레이어가 베팅을 완료하면 playing 단계로 전환
        const allBet = Object.values(data.players).every(p => p.status !== 'betting');
        if (allBet) data.phase = 'playing';
        break;
      }

      /**
       * DECISION: 타이 발생 후 war(전쟁) 또는 surrender(포기) 선택
       * payload: WarDecision
       *
       * war 선택 시: 번 카드(burn) 3장 후 플레이어·딜러에게 1장씩 추가 공개
       * surrender 선택 시: 즉시 done 처리 (calculatePayouts에서 절반 손실)
       */
      case 'DECISION': {
        if (ps.status !== 'tie_pending') return state;

        const decision = action.payload as WarDecision;
        if (!['war', 'surrender'].includes(decision)) return state;

        ps.decision = decision;

        if (decision === 'surrender') {
          ps.status = 'done';
        } else {
          // 전쟁: 번 카드 3장 버리고 재승부
          data.deck.pop(); // burn 1
          data.deck.pop(); // burn 2
          data.deck.pop(); // burn 3
          ps.warPlayerCard = data.deck.pop()!;
          ps.warDealerCard = data.deck.pop()!;
          ps.status = 'war_dealt';
        }

        // 모든 플레이어가 결정을 마쳤는지 확인 후 payout 단계로
        const allResolved = Object.values(data.players).every(
          p => p.status === 'done' || p.status === 'war_dealt',
        );
        if (allResolved && data.phase === 'playing') {
          data.phase = 'payout';
        }
        break;
      }
    }

    // 타이 없이 모든 플레이어가 done이면 바로 payout
    const allDone = Object.values(data.players).every(
      p => p.status === 'done' || p.status === 'war_dealt',
    );
    if (allDone && data.phase === 'playing') {
      data.phase = 'payout';
    }

    return { ...state, data: data as unknown as Record<string, unknown> };
  },

  isRoundOver(state: GameState): boolean {
    const data = state.data as unknown as WarData;
    return data.phase === 'payout';
  },

  calculatePayouts(state: GameState): Payout[] {
    const data = state.data as unknown as WarData;
    const p = GameConfig.games.war.payouts;
    const payouts: Payout[] = [];

    for (const [playerId, ps] of Object.entries(data.players)) {
      if (!ps.playerCard || !ps.dealerCard) {
        payouts.push({ playerId, amount: 0 });
        continue;
      }

      const pv = cardValue(ps.playerCard);
      const dv = cardValue(ps.dealerCard);

      // ── 첫 승부가 타이인 경우 ───────────────────────────────────────────
      if (pv === dv) {
        if (ps.decision === 'surrender') {
          // 포기: 베팅의 절반 손실
          payouts.push({ playerId, amount: Math.floor(ps.bet * p.surrender) });
          continue;
        }

        // 전쟁 재승부
        if (ps.warPlayerCard && ps.warDealerCard) {
          const wpv = cardValue(ps.warPlayerCard);
          const wdv = cardValue(ps.warDealerCard);

          if (wpv > wdv) {
            // 전쟁 승리: 원래 베팅 1:1 (추가 베팅은 별도 처리 없이 동일)
            payouts.push({ playerId, amount: Math.floor(ps.bet * p.war) });
          } else if (wpv === wdv) {
            // 전쟁 중 타이: 보너스 지급
            payouts.push({ playerId, amount: Math.floor(ps.bet * p.tie) });
          } else {
            // 전쟁 패배
            payouts.push({ playerId, amount: -ps.bet });
          }
          continue;
        }

        payouts.push({ playerId, amount: 0 });
        continue;
      }

      // ── 첫 승부 결과 ───────────────────────────────────────────────────
      if (pv > dv) {
        payouts.push({ playerId, amount: Math.floor(ps.bet * p.win) });
      } else {
        payouts.push({ playerId, amount: -ps.bet });
      }
    }

    return payouts;
  },
};

registerGame(WarEngine);
export default WarEngine;
