import type { GameEvent, NightAction, Role } from './types';
import { evaluateWinner } from './game';
import { buildRoleDeck, seededShuffle } from './roles';
import { applyEvents, expectedNightActors, livingPlayers, type GameState } from './engine';

/**
 * Pure game-flow: each command validates against the current state and returns
 * the events it produces — including any cascading resolution/phase-change
 * events. The caller appends these to the log and folds them. Invalid commands
 * throw, so callers surface the message to the client.
 */

const NIGHT_ROLE: Record<NightAction, Role> = { KILL: 'WEREWOLF', PROTECT: 'DOCTOR', INSPECT: 'SEER' };

export function startGame(state: GameState): GameEvent[] {
  if (state.started) throw new Error('Game already started.');
  if (state.phase !== 'LOBBY') throw new Error('Game can only start from the lobby.');
  if (state.players.length < 4) throw new Error('Need at least 4 players to start.');

  const deck = seededShuffle(buildRoleDeck(state.players.length), state.seed);
  const roles: Record<string, Role> = {};
  state.players.forEach((p, i) => {
    roles[p.id] = deck[i]!;
  });
  return [
    { type: 'GAME_STARTED', roles },
    { type: 'PHASE_CHANGED', phase: 'NIGHT', round: 1 },
  ];
}

export function submitChat(state: GameState, playerId: string, text: string): GameEvent[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error('Unknown player.');
  if (!player.alive) throw new Error('Eliminated players cannot speak.');
  return [{ type: 'CHAT', playerId, text, round: state.round }];
}

export function submitNightAction(
  state: GameState,
  playerId: string,
  action: NightAction,
  targetId: string,
): GameEvent[] {
  if (!state.started) throw new Error('Game has not started.');
  if (state.phase !== 'NIGHT') throw new Error('Night actions are only allowed at night.');

  const actor = state.players.find((p) => p.id === playerId);
  if (!actor || !actor.alive) throw new Error('Only living players may act.');
  if (actor.role !== NIGHT_ROLE[action]) throw new Error(`A ${actor.role} cannot perform ${action}.`);
  if (state.night.actorsActed.includes(playerId)) throw new Error('You have already acted this night.');

  if (targetId === playerId) throw new Error('You cannot target yourself at night.');
  const target = state.players.find((p) => p.id === targetId);
  if (!target || !target.alive) throw new Error('Invalid target.');
  if (action === 'KILL' && target.role === 'WEREWOLF') throw new Error('Werewolves cannot kill their own pack.');

  const events: GameEvent[] = [{ type: 'NIGHT_ACTION', playerId, action, targetId }];
  const interim = applyEvents(state, events);
  if (nightComplete(interim)) events.push(...resolveNight(interim));
  return events;
}

/** Cast a ballot. Pass `null` as targetId to abstain. */
export function submitVote(state: GameState, voterId: string, targetId: string | null): GameEvent[] {
  if (!state.started) throw new Error('Game has not started.');

  const events: GameEvent[] = [];
  let current = state;

  // Discussion flows into voting on the first ballot cast.
  if (current.phase === 'DAY_DISCUSSION') {
    const advance: GameEvent = { type: 'PHASE_CHANGED', phase: 'DAY_VOTE', round: current.round };
    events.push(advance);
    current = applyEvents(current, [advance]);
  }
  if (current.phase !== 'DAY_VOTE') throw new Error('Voting is not open right now.');

  const voter = current.players.find((p) => p.id === voterId);
  if (!voter || !voter.alive) throw new Error('Only living players may vote.');
  if (targetId !== null) {
    const target = current.players.find((p) => p.id === targetId);
    if (!target || !target.alive) throw new Error('Invalid vote target.');
  }

  const ballot: GameEvent = { type: 'VOTE_CAST', voterId, targetId, round: current.round };
  events.push(ballot);
  current = applyEvents(current, [ballot]);

  if (voteComplete(current)) events.push(...resolveDay(current));
  return events;
}

// --- internal resolution ----------------------------------------------------

function nightComplete(s: GameState): boolean {
  const expected = expectedNightActors(s);
  return expected.every((p) => s.night.actorsActed.includes(p.id));
}

function voteComplete(s: GameState): boolean {
  return livingPlayers(s).every((p) => p.id in s.votes);
}

function resolveNight(s: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const kill = s.night.killTarget;
  const saved = kill !== null && kill === s.night.protectTarget;

  let living = livingPlayers(s);
  if (kill && !saved) {
    events.push({ type: 'PLAYER_ELIMINATED', playerId: kill, cause: 'WEREWOLF', round: s.round });
    living = living.filter((p) => p.id !== kill);
  }
  return events.concat(endOfPhase(living, 'DAY_DISCUSSION', s.round));
}

function resolveDay(s: GameState): GameEvent[] {
  const counts = new Map<string, number>();
  for (const targetId of Object.values(s.votes)) {
    if (targetId !== null) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }

  // A single highest tally is eliminated. A tie (or everyone abstaining) means
  // no one is lynched — previously ties fell to the earliest joiner, which was
  // almost always the human host.
  const best = Math.max(0, ...counts.values());
  const leaders = [...counts.entries()].filter(([, c]) => c === best).map(([id]) => id);
  const top = best > 0 && leaders.length === 1 ? leaders[0]! : null;

  const events: GameEvent[] = [];
  let living = livingPlayers(s);
  if (top) {
    events.push({ type: 'PLAYER_ELIMINATED', playerId: top, cause: 'VOTE', round: s.round });
    living = living.filter((p) => p.id !== top);
  }
  return events.concat(endOfPhase(living, 'NIGHT', s.round + 1));
}

/** After an elimination, either end the game or advance to the next phase. */
function endOfPhase(living: GameState['players'], nextPhase: 'NIGHT' | 'DAY_DISCUSSION', nextRound: number): GameEvent[] {
  const winner = evaluateWinner(living.map((p) => ({ role: p.role ?? 'VILLAGER', alive: true })));
  if (winner) return [{ type: 'GAME_OVER', winner }];
  return [{ type: 'PHASE_CHANGED', phase: nextPhase, round: nextRound }];
}
