import { registerGame } from '../_engine/GameEngine';
import { GameConfig } from '../../../../../config/game-config';
import type { GameEngine, GameState, Player, PlayerAction, Payout } from '../../../../shared/src/types';

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

interface Card {
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
}

interface BlackjackPlayerState {
  hand: Card[];
  bet: number;
  status: 'waiting_bet' | 'playing' | 'stood' | 'bust' | 'blackjack' | 'done';
}

interface BlackjackData {
  deck: Card[];
  dealer: { hand: Card[] };
  players: Record<string, BlackjackPlayerState>;
  phase: 'betting' | 'playing' | 'dealer_turn' | 'payout';
}

const RANK_VALUES: Record<Rank, number> = {
  A: 11, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, J: 10, Q: 10, K: 10,
};

function buildDeck(numDecks: number): Card[] {
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
  const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank, faceUp: true });
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

function handValue(hand: Card[]): number {
  let total = hand.reduce((sum, c) => sum + RANK_VALUES[c.rank], 0);
  let aces = hand.filter(c => c.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && handValue(hand) === 21;
}

const BlackjackEngine: GameEngine = {
  id: 'blackjack',
  name: 'Blackjack',
  minPlayers: 1,
  maxPlayers: 6,

  initialize(players: Player[]): GameState {
    const cfg = GameConfig.games.blackjack;
    const deck = buildDeck(cfg.decks);

    const playerStates: Record<string, BlackjackPlayerState> = {};
    for (const p of players) {
      playerStates[p.id] = { hand: [], bet: 0, status: 'waiting_bet' };
    }

    const data: BlackjackData = {
      deck,
      dealer: { hand: [] },
      players: playerStates,
      phase: 'betting',
    };

    return {
      gameId: 'blackjack',
      roomId: '',
      players: players.map(p => p.id),
      status: 'in_progress',
      round: 1,
      data: data as unknown as Record<string, unknown>,
    };
  },

  processAction(state: GameState, action: PlayerAction): GameState {
    const data = state.data as unknown as BlackjackData;
    const player = data.players[action.playerId];
    if (!player) return state;

    switch (action.type) {
      case 'BET': {
        const amount = action.payload as number;
        const cfg = GameConfig.games.blackjack;
        if (amount < cfg.minBet || amount > cfg.maxBet) return state;
        player.bet = amount;
        player.status = 'playing';

        const allBet = Object.values(data.players).every(p => p.status !== 'waiting_bet');
        if (allBet) {
          // Deal initial cards
          for (const p of Object.values(data.players)) {
            p.hand = [data.deck.pop()!, data.deck.pop()!];
            if (isBlackjack(p.hand)) p.status = 'blackjack';
          }
          data.dealer.hand = [
            { ...data.deck.pop()!, faceUp: false },
            data.deck.pop()!,
          ];
          data.phase = 'playing';
        }
        break;
      }

      case 'HIT': {
        if (player.status !== 'playing') return state;
        player.hand.push(data.deck.pop()!);
        if (handValue(player.hand) > 21) player.status = 'bust';
        break;
      }

      case 'STAND': {
        if (player.status !== 'playing') return state;
        player.status = 'stood';
        break;
      }

      case 'DOUBLE_DOWN': {
        if (player.status !== 'playing' || player.hand.length !== 2) return state;
        player.bet *= 2;
        player.hand.push(data.deck.pop()!);
        player.status = handValue(player.hand) > 21 ? 'bust' : 'stood';
        break;
      }
    }

    const allDone = Object.values(data.players).every(
      p => p.status !== 'playing' && p.status !== 'waiting_bet',
    );

    if (allDone && data.phase === 'playing') {
      // Reveal dealer hole card and draw
      data.dealer.hand[0].faceUp = true;
      while (handValue(data.dealer.hand) < GameConfig.games.blackjack.dealerStandsOn) {
        data.dealer.hand.push(data.deck.pop()!);
      }
      data.phase = 'payout';
    }

    return { ...state, data: data as unknown as Record<string, unknown> };
  },

  isRoundOver(state: GameState): boolean {
    const data = state.data as unknown as BlackjackData;
    return data.phase === 'payout';
  },

  calculatePayouts(state: GameState): Payout[] {
    const data = state.data as unknown as BlackjackData;
    const dealerVal = handValue(data.dealer.hand);
    const dealerBust = dealerVal > 21;
    const cfg = GameConfig.games.blackjack;
    const payouts: Payout[] = [];

    for (const [playerId, p] of Object.entries(data.players)) {
      if (p.status === 'bust') {
        payouts.push({ playerId, amount: -p.bet });
        continue;
      }
      if (p.status === 'blackjack' && !isBlackjack(data.dealer.hand)) {
        payouts.push({ playerId, amount: Math.floor(p.bet * cfg.blackjackPayout) });
        continue;
      }
      const playerVal = handValue(p.hand);
      if (dealerBust || playerVal > dealerVal) {
        payouts.push({ playerId, amount: p.bet });
      } else if (playerVal === dealerVal) {
        payouts.push({ playerId, amount: 0 });
      } else {
        payouts.push({ playerId, amount: -p.bet });
      }
    }

    return payouts;
  },
};

registerGame(BlackjackEngine);
export default BlackjackEngine;
