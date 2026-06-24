export type PlayerId = string;
export type RoomId = string;
export type GameId = 'blackjack' | 'roulette' | 'baccarat' | 'slots' | 'hiLo' | 'war';

export interface Player {
  id: PlayerId;
  name: string;
  balance: number;
  status: 'active' | 'afk_warned' | 'bankrupt' | 'spectating';
  currentGameId: GameId | null;
  lastActionAt: number;
}

export interface Room {
  id: RoomId;
  hostId: PlayerId;
  players: Player[];
  status: 'waiting' | 'in_progress' | 'finished';
  createdAt: number;
  winnerId: PlayerId | null;
}

export interface PlayerAction {
  playerId: PlayerId;
  type: string;
  payload?: unknown;
}

export interface Payout {
  playerId: PlayerId;
  amount: number;
}

export interface GameState {
  gameId: GameId;
  roomId: RoomId;
  players: PlayerId[];
  status: 'waiting' | 'in_progress' | 'round_over';
  round: number;
  data: Record<string, unknown>;
}

export interface GameEngine {
  id: GameId;
  name: string;
  minPlayers: number;
  maxPlayers: number;

  initialize(players: Player[], config: unknown): GameState;
  processAction(state: GameState, action: PlayerAction): GameState;
  isRoundOver(state: GameState): boolean;
  calculatePayouts(state: GameState): Payout[];
}
