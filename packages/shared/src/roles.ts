import type { Role } from './types';

/**
 * Builds a balanced role deck for a given player count. Werewolves scale at
 * roughly 1 per 4 players; Seer and Doctor appear once the village is big
 * enough to support them. The remainder are Villagers.
 */
export function buildRoleDeck(playerCount: number): Role[] {
  if (playerCount < 4) {
    throw new Error(`ShadowVote needs at least 4 players, got ${playerCount}`);
  }
  const werewolves = Math.max(1, Math.floor(playerCount / 4));
  const deck: Role[] = [];
  for (let i = 0; i < werewolves; i++) deck.push('WEREWOLF');
  deck.push('SEER');
  if (playerCount >= 6) deck.push('DOCTOR');
  while (deck.length < playerCount) deck.push('VILLAGER');
  return deck;
}

/**
 * Deterministic Fisher–Yates shuffle seeded by a string, so a game with the
 * same seed replays identically — the backbone of event-sourced replay.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const arr = [...items];
  const rng = mulberry32(hashSeed(seed));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
