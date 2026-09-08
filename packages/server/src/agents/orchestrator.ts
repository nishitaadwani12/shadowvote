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
  | { kind: 'speak'; player: EnginePlayer }
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
  ) {}

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

    let decision: AgentDecision;
    try {
      decision = await this.agent.decide(ctx);
    } catch {
      decision = { speech: '…', reasoning: '(the agent hesitated and acted on instinct)', targetId: null };
    }

    this.hooks.onReasoning(gameId, player.id, player.name, decision.reasoning, state.round);
    this.memory.remember(gameId, player.id, state.round, `${turn.kind}: ${decision.reasoning}`);

    const target =
      decision.targetId && ctx.candidates.some((c) => c.id === decision.targetId)
        ? decision.targetId
        : ctx.candidates[0]?.id;

    try {
      if (turn.kind === 'night' && target && player.role) {
        this.engine.apply(gameId, player.id, { t: 'NIGHT_ACTION', gameId, action: ROLE_ACTION[player.role]!, targetId: target });
      } else if (turn.kind === 'vote' && target) {
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
    const candidates = livingPlayers(state)
      .filter((p) => p.id !== player.id)
      .map((p) => ({ id: p.id, name: p.name }));
    const transcript = state.transcript
      .slice(-20)
      .map((l) => `${l.name}: ${l.text}`)
      .join('\n');
    return {
      role: player.role ?? 'VILLAGER',
      persona: player.persona ?? 'a level-headed player',
      round: state.round,
      phase: state.phase,
      transcript,
      memories: this.memory.recall(gameId, player.id),
      candidates,
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
    const toSpeak = livingAi.find((p) => !spokeThisRound(state, p.id));
    if (toSpeak) return { kind: 'speak', player: toSpeak };
    const toVote = livingAi.find((p) => !(p.id in state.votes));
    return toVote ? { kind: 'vote', player: toVote } : null;
  }

  if (state.phase === 'DAY_VOTE') {
    const toVote = livingAi.find((p) => !(p.id in state.votes));
    return toVote ? { kind: 'vote', player: toVote } : null;
  }

  return null;
}

function spokeThisRound(state: GameState, playerId: string): boolean {
  return state.transcript.some((l) => l.playerId === playerId && l.round === state.round);
}
