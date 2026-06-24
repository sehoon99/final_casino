import type { GameEngine, GameId } from '../../../../shared/src/types';

const registry = new Map<GameId, GameEngine>();

export function registerGame(engine: GameEngine): void {
  registry.set(engine.id, engine);
}

export function getGame(id: GameId): GameEngine {
  const engine = registry.get(id);
  if (!engine) throw new Error(`Game not registered: ${id}`);
  return engine;
}

export function listGames(): GameEngine[] {
  return Array.from(registry.values());
}
