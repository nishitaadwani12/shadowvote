/**
 * Single source of truth for the ShadowVote domain, shared by server and web.
 *
 * The game is modelled as an event-sourced state machine: the authoritative
 * game state is a fold over an append-only list of {@link GameEvent}s. Both the
 * server engine and the client renderer speak the same phases and messages.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = ['VILLAGER', 'WEREWOLF', 'SEER', 'DOCTOR'] as const;
export type Role = (typeof ROLES)[number];

/** Which faction a role belongs to; drives win-condition evaluation. */
export type Faction = 'VILLAGE' | 'WEREWOLF';

export const ROLE_FACTION: Record<Role, Faction> = {
  VILLAGER: 'VILLAGE',
  SEER: 'VILLAGE',
  DOCTOR: 'VILLAGE',
  WEREWOLF: 'WEREWOLF',
};

// ---------------------------------------------------------------------------
// Phases (the state machine)
// ---------------------------------------------------------------------------

/**
 * LOBBY          → players join, host starts
 * NIGHT          → werewolves choose a kill; seer inspects; doctor protects
 * DAY_DISCUSSION → open chat; agents reason and posture
 * DAY_VOTE       → each living player votes to eliminate one
 * RESOLVE        → apply votes/night actions, check win condition
 * GAME_OVER      → terminal
 */
export const PHASES = [
  'LOBBY',
  'NIGHT',
  'DAY_DISCUSSION',
  'DAY_VOTE',
  'RESOLVE',
  'GAME_OVER',
] as const;
export type Phase = (typeof PHASES)[number];

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface PlayerPublic {
  id: string;
  name: string;
  isAi: boolean;
  alive: boolean;
}

export interface PlayerPrivate extends PlayerPublic {
  role: Role;
  /** AI persona seed; null for human players. */
  persona: string | null;
}

/** The view a given client is allowed to see (roles of others stay hidden). */
export interface GameStateView {
  gameId: string;
  phase: Phase;
  round: number;
  players: PlayerPublic[];
  /** Present only for the requesting player. */
  you: PlayerPrivate | null;
  transcript: ChatLine[];
  winner: Faction | null;
}

export interface ChatLine {
  playerId: string;
  name: string;
  text: string;
  round: number;
  at: number;
}

// ---------------------------------------------------------------------------
// Event store
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'GAME_CREATED'; gameId: string; seed: string }
  | { type: 'PLAYER_JOINED'; playerId: string; name: string; isAi: boolean }
  | { type: 'GAME_STARTED'; roles: Record<string, Role> }
  | { type: 'PHASE_CHANGED'; phase: Phase; round: number }
  | { type: 'CHAT'; playerId: string; text: string; round: number }
  | { type: 'NIGHT_ACTION'; playerId: string; action: NightAction; targetId: string }
  | { type: 'VOTE_CAST'; voterId: string; targetId: string; round: number }
  | { type: 'PLAYER_ELIMINATED'; playerId: string; cause: 'VOTE' | 'WEREWOLF'; round: number }
  | { type: 'GAME_OVER'; winner: Faction };

export type NightAction = 'KILL' | 'INSPECT' | 'PROTECT';

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'JOIN'; gameId: string; name: string }
  | { t: 'START'; gameId: string }
  | { t: 'CHAT'; gameId: string; text: string }
  | { t: 'NIGHT_ACTION'; gameId: string; action: NightAction; targetId: string }
  | { t: 'VOTE'; gameId: string; targetId: string }
  | { t: 'RESYNC'; gameId: string };

export type ServerMessage =
  | { t: 'JOINED'; playerId: string; gameId: string }
  | { t: 'STATE'; state: GameStateView }
  | { t: 'PHASE_CHANGED'; phase: Phase; round: number }
  | { t: 'CHAT_MSG'; line: ChatLine }
  | { t: 'AGENT_REASONING'; playerId: string; name: string; reasoning: string; round: number }
  | { t: 'GAME_OVER'; winner: Faction }
  | { t: 'ERROR'; message: string };
