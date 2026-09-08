import type { ChatLine, Faction, GameEvent, GameStateView, Phase, Role } from './types';
import { factionOf } from './game';

/**
 * The authoritative, in-memory game state. It is never mutated directly — it
 * is always the result of folding the append-only event log via {@link applyEvent}.
 * This is what makes replay and crash recovery possible.
 */

export interface EnginePlayer {
  id: string;
  name: string;
  isAi: boolean;
  persona: string | null;
  role: Role | null;
  alive: boolean;
}

interface NightState {
  killTarget: string | null;
  protectTarget: string | null;
  /** Ids of role-holders who have submitted their night action this round. */
  actorsActed: string[];
}

interface Inspection {
  round: number;
  seerId: string;
  targetId: string;
  faction: Faction;
}

export interface GameState {
  gameId: string;
  seed: string;
  phase: Phase;
  round: number;
  started: boolean;
  players: EnginePlayer[];
  transcript: ChatLine[];
  night: NightState;
  /** Current-round ballots: voterId -> targetId. */
  votes: Record<string, string>;
  inspections: Inspection[];
  winner: Faction | null;
}

const emptyNight = (): NightState => ({ killTarget: null, protectTarget: null, actorsActed: [] });

export function initialState(gameId: string, seed: string): GameState {
  return {
    gameId,
    seed,
    phase: 'LOBBY',
    round: 0,
    started: false,
    players: [],
    transcript: [],
    night: emptyNight(),
    votes: {},
    inspections: [],
    winner: null,
  };
}

/** The single reducer: apply one event to produce the next immutable state. */
export function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'GAME_CREATED':
      return { ...state, gameId: event.gameId, seed: event.seed };

    case 'PLAYER_JOINED':
      return {
        ...state,
        players: [
          ...state.players,
          { id: event.playerId, name: event.name, isAi: event.isAi, persona: event.persona ?? null, role: null, alive: true },
        ],
      };

    case 'GAME_STARTED':
      return {
        ...state,
        started: true,
        players: state.players.map((p) => ({ ...p, role: event.roles[p.id] ?? p.role })),
      };

    case 'PHASE_CHANGED': {
      const next: GameState = { ...state, phase: event.phase, round: event.round };
      if (event.phase === 'NIGHT') {
        next.night = emptyNight();
        next.votes = {};
      }
      if (event.phase === 'DAY_VOTE') next.votes = {};
      return next;
    }

    case 'CHAT': {
      const author = state.players.find((p) => p.id === event.playerId);
      const line: ChatLine = {
        playerId: event.playerId,
        name: author?.name ?? 'unknown',
        text: event.text,
        round: event.round,
        at: state.transcript.length,
      };
      return { ...state, transcript: [...state.transcript, line] };
    }

    case 'NIGHT_ACTION': {
      const night: NightState = { ...state.night, actorsActed: [...state.night.actorsActed, event.playerId] };
      const inspections = [...state.inspections];
      if (event.action === 'KILL') night.killTarget = event.targetId;
      else if (event.action === 'PROTECT') night.protectTarget = event.targetId;
      else if (event.action === 'INSPECT') {
        const target = state.players.find((p) => p.id === event.targetId);
        if (target?.role) {
          inspections.push({ round: state.round, seerId: event.playerId, targetId: event.targetId, faction: factionOf(target.role) });
        }
      }
      return { ...state, night, inspections };
    }

    case 'VOTE_CAST':
      return { ...state, votes: { ...state.votes, [event.voterId]: event.targetId } };

    case 'PLAYER_ELIMINATED':
      return {
        ...state,
        players: state.players.map((p) => (p.id === event.playerId ? { ...p, alive: false } : p)),
      };

    case 'GAME_OVER':
      return { ...state, winner: event.winner, phase: 'GAME_OVER' };

    default:
      return state;
  }
}

/** Fold a sequence of events onto an existing state. */
export function applyEvents(state: GameState, events: GameEvent[]): GameState {
  return events.reduce(applyEvent, state);
}

/** Rebuild state from scratch — the crash-recovery / replay entry point. */
export function foldEvents(events: GameEvent[], gameId: string, seed: string): GameState {
  return applyEvents(initialState(gameId, seed), events);
}

// --- selectors --------------------------------------------------------------

export const livingPlayers = (s: GameState): EnginePlayer[] => s.players.filter((p) => p.alive);

/** Living players whose role must submit a night action before night resolves. */
export const expectedNightActors = (s: GameState): EnginePlayer[] =>
  livingPlayers(s).filter((p) => p.role === 'WEREWOLF' || p.role === 'SEER' || p.role === 'DOCTOR');

/**
 * Projects the authoritative state down to what a specific player is allowed
 * to see: other players' roles stay hidden; the seer's own results appear as
 * private notes.
 */
export function viewFor(state: GameState, playerId: string): GameStateView {
  const me = state.players.find((p) => p.id === playerId);
  const notes: string[] = [];
  if (me?.role === 'SEER') {
    for (const ins of state.inspections) {
      if (ins.seerId === playerId) {
        const target = state.players.find((p) => p.id === ins.targetId);
        notes.push(`Round ${ins.round}: ${target?.name ?? ins.targetId} is aligned with ${ins.faction}.`);
      }
    }
  }
  return {
    gameId: state.gameId,
    phase: state.phase,
    round: state.round,
    players: state.players.map((p) => ({ id: p.id, name: p.name, isAi: p.isAi, alive: p.alive })),
    you:
      state.started && me && me.role
        ? { id: me.id, name: me.name, isAi: me.isAi, alive: me.alive, role: me.role, persona: me.persona }
        : null,
    notes,
    transcript: state.transcript,
    winner: state.winner,
  };
}
