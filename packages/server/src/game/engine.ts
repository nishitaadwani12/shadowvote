import { randomUUID } from 'node:crypto';
import {
  applyEvents,
  foldEvents,
  startGame,
  submitChat,
  submitNightAction,
  submitVote,
  viewFor,
  type ClientMessage,
  type GameEvent,
  type GameState,
  type GameStateView,
} from '@shadowvote/shared';

interface Game {
  /** Append-only event log — the source of truth; state is always a fold of it. */
  log: GameEvent[];
  state: GameState;
}

/**
 * Stateful wrapper around the pure shared engine. Owns the per-game event log,
 * assigns player ids, routes client commands to the pure flow functions, and
 * commits the resulting events. Persistence to Postgres is a drop-in here (the
 * `events` table mirrors `log`); P1 keeps the log in memory.
 */
export class GameEngine {
  private readonly games = new Map<string, Game>();

  private ensure(gameId: string): Game {
    let game = this.games.get(gameId);
    if (!game) {
      const seed = randomUUID();
      const log: GameEvent[] = [{ type: 'GAME_CREATED', gameId, seed }];
      game = { log, state: foldEvents(log, gameId, seed) };
      this.games.set(gameId, game);
    }
    return game;
  }

  private commit(game: Game, events: GameEvent[]): void {
    game.log.push(...events);
    game.state = applyEvents(game.state, events);
  }

  join(gameId: string, name: string): string {
    const game = this.ensure(gameId);
    const playerId = randomUUID();
    this.commit(game, [{ type: 'PLAYER_JOINED', playerId, name, isAi: false }]);
    return playerId;
  }

  /** Apply a gameplay command. Throws on invalid input; the caller surfaces the message. */
  apply(gameId: string, playerId: string, msg: ClientMessage): void {
    const game = this.games.get(gameId);
    if (!game) throw new Error('No such game.');
    const s = game.state;

    let events: GameEvent[];
    switch (msg.t) {
      case 'START':
        events = startGame(s);
        break;
      case 'CHAT':
        events = submitChat(s, playerId, msg.text);
        break;
      case 'NIGHT_ACTION':
        events = submitNightAction(s, playerId, msg.action, msg.targetId);
        break;
      case 'VOTE':
        events = submitVote(s, playerId, msg.targetId);
        break;
      default:
        throw new Error(`Unsupported command: ${msg.t}`);
    }
    this.commit(game, events);
  }

  view(gameId: string, playerId: string): GameStateView | null {
    const game = this.games.get(gameId);
    return game ? viewFor(game.state, playerId) : null;
  }

  state(gameId: string): GameState | undefined {
    return this.games.get(gameId)?.state;
  }
}
