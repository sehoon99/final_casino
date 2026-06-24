export interface RoomMeta {
  pk: string;           // ROOM#{roomId}
  sk: 'META';
  roomId: string;
  hostId: string;
  status: 'waiting' | 'in_progress' | 'finished';
  maxPlayers: number;
  playerCount: number;
  createdAt: number;
  winnerId?: string;
}

export interface RoomPlayer {
  pk: string;           // ROOM#{roomId}
  sk: string;           // PLAYER#{userId}
  roomId: string;
  userId: string;
  name: string;
  balance: number;
  status: 'active' | 'afk_warned' | 'bankrupt';
  currentGameId: string | null;
  lastActionAt: number;
  joinedAt: number;
}
