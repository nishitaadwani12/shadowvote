import type { Faction, Phase, PlayerPrivate, Role } from './types';
import { ROLE_FACTION } from './types';

/**
 * Legal phase transitions. The engine MUST reject any transition not listed
 * here — this map is the guard rail that keeps the game a well-formed state
 * machine rather than an ad-hoc sequence of mutations.
 */
const TRANSITIONS: Record<Phase, Phase[]> = {
  LOBBY: ['NIGHT'],
  NIGHT: ['DAY_DISCUSSION'],
  DAY_DISCUSSION: ['DAY_VOTE'],
  DAY_VOTE: ['RESOLVE'],
  RESOLVE: ['NIGHT', 'GAME_OVER'],
  GAME_OVER: [],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: Phase, to: Phase): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal phase transition: ${from} -> ${to}`);
  }
}

/**
 * Win condition: werewolves win once they reach parity with (or outnumber)
 * the village; the village wins when every werewolf is dead. Returns null
 * while the game is still live.
 */
export function evaluateWinner(players: Pick<PlayerPrivate, 'role' | 'alive'>[]): Faction | null {
  const living = players.filter((p) => p.alive);
  const wolves = living.filter((p) => factionOf(p.role) === 'WEREWOLF').length;
  const villagers = living.length - wolves;
  if (wolves === 0) return 'VILLAGE';
  if (wolves >= villagers) return 'WEREWOLF';
  return null;
}

export function factionOf(role: Role): Faction {
  return ROLE_FACTION[role];
}
