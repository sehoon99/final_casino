# Coding Conventions

## Language & Runtime
- TypeScript strict mode throughout
- Node.js 20.x for Lambda functions
- ESM modules (`import`/`export`)

## File Structure
- Each game is a self-contained folder under `packages/backend/functions/games/<game-name>/`
- Every game must export a default `GameEngine` implementation and call `registerGame()` at module load
- Shared types live in `packages/shared/src/types.ts` — never duplicate type definitions

## Game Engine Contract
All games must implement the `GameEngine` interface from `packages/shared/src/types.ts`:
- `initialize()` — sets up initial state, no side effects
- `processAction()` — pure function, returns new state
- `isRoundOver()` — checks if round should end
- `calculatePayouts()` — returns delta amounts (positive = win, negative = loss)

## Config
- All tunable parameters come from `config/game-config.ts`
- Never hardcode bet limits, probabilities, or timing values in game logic
- Access via `GameConfig.games.<gameId>.<param>`

## Naming
- Files: `camelCase.ts`
- Types/Interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Functions: `camelCase`

## Error Handling
- Lambda handlers return `{ statusCode, body }` — never throw unhandled
- Game logic returns unchanged state on invalid actions (no throws)

## Tags (AWS Resources)
Every Terraform resource must include:
```hcl
tags = {
  Environment = var.environment
  Team        = "casino-night"
  Service     = "<service-name>"
  ManagedBy   = "terraform"
}
```
