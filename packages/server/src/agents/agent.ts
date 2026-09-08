import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { NightAction, Role } from '@shadowvote/shared';
import { env } from '../env';

/** Role-specific strategy injected into the prompt so agents play their part well. */
const ROLE_GUIDANCE: Record<Role, string> = {
  WEREWOLF:
    'You are a werewolf. At night you and your allies kill a villager. By day, blend in: deflect suspicion, cast doubt on innocents, and never reveal your pack. You win when werewolves equal the villagers.',
  SEER:
    'You are the seer. Each night you learn one player\'s true alignment. Use your knowledge to steer the village, but reveal yourself carefully — outing yourself makes you the wolves\' next target.',
  DOCTOR:
    'You are the doctor. Each night you protect one player from the wolves. Read the table to guess who they\'ll strike; you may protect yourself sparingly.',
  VILLAGER:
    'You are a villager with no special power. Your weapons are logic and persuasion: track claims, spot contradictions, and rally votes against the likeliest wolves.',
};

/** The structured decision an AI player returns on its turn. */
export interface AgentDecision {
  /** What the agent says out loud to the table. */
  speech: string;
  /** Hidden chain-of-thought surfaced in the reasoning inspector (never to opponents). */
  reasoning: string;
  /** A player id to act on (vote target, night target), or null to abstain. */
  targetId: string | null;
}

export interface AgentContext {
  role: Role;
  persona: string;
  round: number;
  phase: string;
  /** Public chat transcript the agent can reason over. */
  transcript: string;
  /** This agent's private memories from earlier rounds. */
  memories: string[];
  /** Candidate player ids the agent may target this turn. */
  candidates: { id: string; name: string }[];
  /** Known allies (fellow werewolves) — empty for village roles. */
  allies: { id: string; name: string }[];
  nightAction?: NightAction;
}

export interface Agent {
  decide(ctx: AgentContext): Promise<AgentDecision>;
}

/**
 * Gemini-backed agent. Uses structured output so the model must return a
 * well-formed {speech, reasoning, targetId} object we can persist and act on.
 * Wired up in P2; requires GEMINI_API_KEY.
 */
export class GeminiAgent implements Agent {
  private readonly model;

  constructor(modelName = 'gemini-2.0-flash') {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set — required for AI players.');
    }
    const genai = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    this.model = genai.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            speech: { type: SchemaType.STRING },
            reasoning: { type: SchemaType.STRING },
            targetId: { type: SchemaType.STRING },
          },
          required: ['speech', 'reasoning', 'targetId'],
        },
      },
    });
  }

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const result = await this.model.generateContent(buildPrompt(ctx));
    const parsed = JSON.parse(result.response.text()) as AgentDecision;
    const validTarget = ctx.candidates.some((c) => c.id === parsed.targetId);
    return { ...parsed, targetId: validTarget ? parsed.targetId : null };
  }
}

function buildPrompt(ctx: AgentContext): string {
  const roster = ctx.candidates.map((c) => `- ${c.name} (id: ${c.id})`).join('\n');
  const task =
    ctx.phase === 'DAY_DISCUSSION'
      ? 'It is the day discussion. Speak to the table to shape opinion; targetId may be who you lean toward voting.'
      : ctx.phase === 'DAY_VOTE'
        ? 'It is the vote. Choose the player you want eliminated (targetId).'
        : `It is night. As the ${ctx.role}, choose who to ${(ctx.nightAction ?? 'ACT').toLowerCase()} (targetId).`;

  return [
    `You are playing the social-deduction game Werewolf. Your secret role is ${ctx.role}.`,
    ROLE_GUIDANCE[ctx.role],
    `Your persona (stay in character): ${ctx.persona}.`,
    ctx.allies.length ? `Your fellow werewolves are: ${ctx.allies.map((a) => a.name).join(', ')}. Never betray them.` : '',
    `Phase: ${ctx.phase}, round ${ctx.round}.`,
    ctx.memories.length ? `Your private notes from earlier rounds:\n${ctx.memories.join('\n')}` : '',
    `Public conversation so far:\n${ctx.transcript || '(nothing said yet)'}`,
    `Players you may target (use their exact id, or "" to abstain):\n${roster}`,
    task,
    'Reply as JSON with: speech (one or two natural sentences you say aloud; empty at night),',
    'reasoning (your private strategy — this is never shown to opponents), and targetId.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
