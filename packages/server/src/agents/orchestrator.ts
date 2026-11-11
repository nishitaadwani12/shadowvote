import {
  expectedNightActors,
  livingPlayers,
  type EnginePlayer,
  type GameState,
  type NightAction,
  type Role,
} from '@shadowvote/shared';
import type { GameEngine } from '../game/engine';
import type { Agent, AgentContext, AgentDecision } from './agent';
import type { AgentMemory } from './memory';

const ROLE_ACTION: Partial<Record<Role, NightAction>> = {
  WEREWOLF: 'KILL',
  DOCTOR: 'PROTECT',
  SEER: 'INSPECT',
};

type Turn =
  | { kind: 'night'; player: EnginePlayer }
  | { kind: 'speak'; player: EnginePlayer; replyTo?: { name: string; text: string } }
  | { kind: 'vote'; player: EnginePlayer };

export interface OrchestratorHooks {
  /** Called when an AI reveals its hidden reasoning (streamed to the inspector). */
  onReasoning(gameId: string, playerId: string, name: string, reasoning: string, round: number): void;
  /** Called after each committed AI action so the caller can broadcast state. */
  onProgress(gameId: string): void;
}

/** Guards against a runaway loop if the game somehow fails to make progress. */
const MAX_TURNS_PER_TICK = 500;

/**
 * Drives AI players' turns off the request path. After any state change, `tick`
 * runs every pending AI action in order until the game is waiting on a human or
 * is over. A per-game lock prevents overlapping runs.
 */
export class AgentOrchestrator {
  private readonly busy = new Set<string>();

  constructor(
    private readonly engine: GameEngine,
    private readonly agent: Agent,
    private readonly hooks: OrchestratorHooks,
    private readonly memory: AgentMemory,
    /** Injectable so tests can make fallback picks deterministic. */
    private readonly random: () => number = Math.random,
  ) {}

  private pickRandom<T>(items: readonly T[]): T | undefined {
    return items.length ? items[Math.floor(this.random() * items.length)] : undefined;
  }

  async tick(gameId: string): Promise<void> {
    if (this.busy.has(gameId)) return;
    this.busy.add(gameId);
    try {
      for (let i = 0; i < MAX_TURNS_PER_TICK; i++) {
        const state = this.engine.state(gameId);
        if (!state || state.winner) break;
        const turn = nextTurn(state);
        if (!turn) break; // waiting on a human, or nothing to do
        const applied = await this.perform(gameId, state, turn);
        if (!applied) break; // action rejected — stop rather than loop
        this.hooks.onProgress(gameId);
      }
    } finally {
      this.busy.delete(gameId);
    }
  }

  private async perform(gameId: string, state: GameState, turn: Turn): Promise<boolean> {
    const { player } = turn;
    const ctx = this.buildContext(gameId, state, player);
    // An AI's first ballot is cast while the phase is still DAY_DISCUSSION; tell it it's voting.
    if (turn.kind === 'vote') ctx.phase = 'DAY_VOTE';
    if (turn.kind === 'speak' && turn.replyTo) ctx.replyTo = turn.replyTo;

    let decision: AgentDecision;
    try {
      decision = await this.agent.decide(ctx);
    } catch {
      decision = { speech: '…', reasoning: '(the agent hesitated and acted on instinct)', targetId: null };
    }

    this.hooks.onReasoning(gameId, player.id, player.name, decision.reasoning, state.round);
    this.memory.remember(gameId, player.id, state.round, `${turn.kind}: ${decision.reasoning}`);

    const chosen =
      decision.targetId && ctx.candidates.some((c) => c.id === decision.targetId) ? decision.targetId : null;
    // No valid pick: a vote becomes a real abstain; a night action (which must
    // happen for the night to resolve) falls back to a *random* legal target.
    // Previously both fell back to candidates[0] — the first joiner, i.e. the human.
    const target = chosen ?? (turn.kind === 'night' ? this.pickRandom(ctx.candidates)?.id ?? null : null);

    try {
      if (turn.kind === 'night' && target && player.role) {
        this.engine.apply(gameId, player.id, { t: 'NIGHT_ACTION', gameId, action: ROLE_ACTION[player.role]!, targetId: target });
      } else if (turn.kind === 'vote') {
        this.engine.apply(gameId, player.id, { t: 'VOTE', gameId, targetId: target });
      } else if (turn.kind === 'speak') {
        this.engine.apply(gameId, player.id, { t: 'CHAT', gameId, text: decision.speech || '…' });
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private buildContext(gameId: string, state: GameState, player: EnginePlayer): AgentContext {
    const living = livingPlayers(state);
    const allies =
      player.role === 'WEREWOLF'
        ? living.filter((p) => p.role === 'WEREWOLF' && p.id !== player.id).map((p) => ({ id: p.id, name: p.name }))
        : [];
    // Werewolves may not kill their own pack at night.
    const excludeAllies = state.phase === 'NIGHT' && player.role === 'WEREWOLF';
    const candidates = living
      .filter((p) => p.id !== player.id && !(excludeAllies && allies.some((a) => a.id === p.id)))
      .map((p) => ({ id: p.id, name: p.name }));
    const transcript = state.transcript
      .slice(-20)
      .map((l) => `${l.name}: ${l.text}`)
      .join('\n');
    return {
      self: { id: player.id, name: player.name },
      role: player.role ?? 'VILLAGER',
      persona: player.persona ?? 'a level-headed player',
      round: state.round,
      phase: state.phase,
      transcript,
      memories: this.memory.recall(gameId, player.id),
      candidates,
      allies,
      packPick: excludeAllies && state.night.killTarget
        ? candidates.find((c) => c.id === state.night.killTarget) ?? null
        : null,
      nightAction: player.role ? ROLE_ACTION[player.role] : undefined,
    };
  }
}

/** Determine the next AI action for the current state, or null to wait on a human. */
function nextTurn(state: GameState): Turn | null {
  const livingAi = livingPlayers(state).filter((p) => p.isAi);

  if (state.phase === 'NIGHT') {
    const actor = expectedNightActors(state).find((p) => p.isAi && !state.night.actorsActed.includes(p.id));
    return actor ? { kind: 'night', player: actor } : null;
  }

  if (state.phase === 'DAY_DISCUSSION') {
    // 1. Everyone gives an opening statement.
    const toSpeak = livingAi.find((p) => !spokeThisRound(state, p.id));
    if (toSpeak) return { kind: 'speak', player: toSpeak };

    // 2. With no living human at the table, AIs move straight to the vote.
    const humansAlive = livingPlayers(state).some((p) => !p.isAi);
    if (!humansAlive) {
      const toVote = livingAi.find((p) => !(p.id in state.votes));
      return toVote ? { kind: 'vote', player: toVote } : null;
    }

    // 3. Otherwise the table talks *with* the human: each human message gets
    //    replies, and the vote only opens when a human votes (or skips).
    const responder = nextResponder(state, livingAi);
    return responder ? { kind: 'speak', player: responder.player, replyTo: responder.replyTo } : null;
  }

  if (state.phase === 'DAY_VOTE') {
    const toVote = livingAi.find((p) => !(p.id in state.votes));
    return toVote ? { kind: 'vote', player: toVote } : null;
  }

  return null;
}

/** How many AIs answer each human message, and a per-round cap so talk can't run forever. */
export const REPLIES_PER_HUMAN_MESSAGE = 2;
export const MAX_LINES_PER_AI_PER_ROUND = 4;

/** Pick the AI that should answer the latest human message, if any reply is still owed. */
function nextResponder(
  state: GameState,
  livingAi: EnginePlayer[],
): { player: EnginePlayer; replyTo: { name: string; text: string } } | null {
  const lines = state.transcript.filter((l) => l.round === state.round);
  const isHuman = (id: string) => state.players.some((p) => p.id === id && !p.isAi);
  let lastHuman = -1;
  lines.forEach((l, i) => {
    if (isHuman(l.playerId)) lastHuman = i;
  });
  if (lastHuman < 0) return null;

  const human = lines[lastHuman]!;
  const repliedSince = new Set(lines.slice(lastHuman + 1).map((l) => l.playerId));
  if (repliedSince.size >= REPLIES_PER_HUMAN_MESSAGE) return null;

  const linesBy = (id: string) => lines.filter((l) => l.playerId === id).length;
  // Where a player's name first appears in the message (Infinity if not at all). The person
  // being addressed is usually named first ("Riya, you just repeated Dev and Kabir…").
  const mentionAt = (p: EnginePlayer) => {
    const m = new RegExp(`\\b${escapeRegExp(p.name)}\\b`, 'i').exec(human.text);
    return m ? m.index : Infinity;
  };
  const pool = livingAi
    .filter((p) => !repliedSince.has(p.id) && linesBy(p.id) < MAX_LINES_PER_AI_PER_ROUND)
    // Named players answer first, in the order they were named; then whoever has spoken least.
    .sort((a, b) => mentionAt(a) - mentionAt(b) || linesBy(a.id) - linesBy(b.id));
  const player = pool[0];
  return player ? { player, replyTo: { name: human.name, text: human.text } } : null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function spokeThisRound(state: GameState, playerId: string): boolean {
  return state.transcript.some((l) => l.playerId === playerId && l.round === state.round);
}
