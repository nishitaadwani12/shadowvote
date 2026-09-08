import { randomUUID } from 'node:crypto';
import {
  applyEvents,
  foldEvents,
  initialState,
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
import { InMemoryEventStore, type EventStore } from '../db/event-store';

interface Game {
  gameId: string;
  seed: string;
  /** Append-only event log — the source of truth; state is always a fold of it. */
  log: GameEvent[];
  state: GameState;
}

/**
 * Stateful wrapper around the pure shared engine. Owns the per-game event log,
 * assigns player ids, routes client commands to the pure flow functions, and
 * commits the resulting events — writing them through to the {@link EventStore}
 * so a restarted process can {@link hydrate} back to the exact same state.
 */
export class GameEngine {
  private readonly games = new Map<string, Game>();

  constructor(
    private readonly store: EventStore = new InMemoryEventStore(),
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  /** Rebuild all games from the persisted event log. Call once at startup. */
  async hydrate(): Promise<number> {
    const stored = await this.store.loadAll();
    for (const [gameId, { seed, events }] of stored) {
      this.games.set(gameId, { gameId, seed, log: events, state: foldEvents(events, gameId, seed) });
    }
    return this.games.size;
  }

  private ensure(gameId: string): Game {
    let game = this.games.get(gameId);
    if (!game) {
      const seed = randomUUID();
      game = { gameId, seed, log: [], state: initialState(gameId, seed) };
      this.games.set(gameId, game);
      this.record(game, [{ type: 'GAME_CREATED', gameId, seed }]);
    }
    return game;
  }

  /** Append events to the log, fold into state, and persist (write-through). */
  private record(game: Game, events: GameEvent[]): void {
    const startSeq = game.log.length;
    game.log.push(...events);
    game.state = applyEvents(game.state, events);
    this.store.append(game.gameId, game.seed, events, startSeq).catch(this.onError);
  }

  join(gameId: string, name: string): string {
    const game = this.ensure(gameId);
    const playerId = randomUUID();
    this.record(game, [{ type: 'PLAYER_JOINED', playerId, name, isAi: false }]);
    return playerId;
  }

  addAi(gameId: string, name: string, persona?: string): string {
    const game = this.ensure(gameId);
    if (game.state.started) throw new Error('Cannot add players after the game has started.');
    const playerId = randomUUID();
    this.record(game, [{ type: 'PLAYER_JOINED', playerId, name, isAi: true, persona }]);
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
    this.record(game, events);
  }

  view(gameId: string, playerId: string): GameStateView | null {
    const game = this.games.get(gameId);
    return game ? viewFor(game.state, playerId) : null;
  }

  state(gameId: string): GameState | undefined {
    return this.games.get(gameId)?.state;
  }
}
