import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { NightAction, Role } from '@shadowvote/shared';
import { env } from '../env';

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
  return [
    `You are playing Werewolf. Your secret role is ${ctx.role}.`,
    `Persona: ${ctx.persona}`,
    `Phase: ${ctx.phase}, round ${ctx.round}.`,
    ctx.memories.length ? `Your private notes:\n${ctx.memories.join('\n')}` : '',
    `Public conversation so far:\n${ctx.transcript || '(nothing yet)'}`,
    `Players you may target (use their id, or empty string to abstain):\n${roster}`,
    'Respond with speech (what you say aloud), reasoning (your hidden strategy),',
    'and targetId (who you act on). Stay in character and play to win for your faction.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
