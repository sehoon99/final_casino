# Project Structure

## Overview
Casino Night — serverless virtual-chip tournament platform on AWS.
Friends create a private room, play various casino games, last player with chips wins.

## Monorepo Layout
```
casino-platform/
├── config/
│   └── game-config.ts          # Single source of truth for all parameters
├── packages/
│   ├── shared/src/
│   │   └── types.ts            # Shared TypeScript types (Player, Room, GameEngine, etc.)
│   ├── frontend/               # Next.js 14 App Router
│   └── backend/
│       └── functions/
│           ├── auth/           # Cognito triggers
│           ├── room/           # Room create/join/leave
│           ├── websocket/      # API Gateway WebSocket handlers
│           ├── player/         # Balance management
│           ├── leaderboard/    # Real-time rankings
│           ├── notification/   # EventBridge subscriber for alerts
│           ├── scheduler/      # AFK detection via EventBridge Scheduler
│           ├── history/        # Game history recording
│           └── games/
│               ├── _engine/    # Registry + GameEngine interface
│               ├── blackjack/  # ✅ Reference implementation
│               ├── roulette/   # 🔲 To implement
│               ├── baccarat/   # 🔲 To implement
│               ├── slots/      # 🔲 To implement
│               ├── hi-lo/      # 🔲 To implement
│               └── war/        # 🔲 To implement
└── infrastructure/
    └── terraform/
        ├── modules/            # Reusable modules (api-gateway, lambda, dynamodb, etc.)
        └── environments/
            ├── dev/
            └── prod/
```

## Key Patterns

### Adding a New Game
1. Create `packages/backend/functions/games/<name>/index.ts`
2. Implement `GameEngine` interface from `packages/shared/src/types.ts`
3. Call `registerGame(engine)` at the bottom of the file
4. Add config entry in `config/game-config.ts` under `games`
5. No other files need to change — the engine auto-registers

### Event Flow
```
Game Lambda → EventBridge
  ├── BALANCE_CHANGED  → WebSocket broadcast + leaderboard update
  ├── RANK_CHANGED     → notification Lambda
  ├── AFK_DETECTED     → scheduler Lambda applies penalty
  └── PLAYER_BANKRUPT  → room Lambda checks win condition
```

### DynamoDB Access Pattern
Single-table design. All queries go through `packages/backend/functions/player/` or `room/`.
Game logic never directly accesses DynamoDB.
