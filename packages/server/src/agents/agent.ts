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
    'You are the doctor. Each night you protect one player from the wolves. Read the table to guess who they\'ll strike; you cannot protect yourself, so choose whom to shield wisely.',
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
  /** Who this agent is at the table — without it the model can't tell itself apart from others. */
  self: { id: string; name: string };
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
  /** Set when this turn is a reply to something a human just said. */
  replyTo?: { name: string; text: string };
  /** At night, the kill the pack has agreed on so far (wolves only). */
  packPick?: { id: string; name: string } | null;
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

  constructor(modelName = env.GEMINI_MODEL) {
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
    `You are playing the social-deduction game Werewolf. Your name at the table is ${ctx.self.name} (id: ${ctx.self.id}). Your secret role is ${ctx.role}.`,
    `Always speak about yourself in the first person ("I"), never as "${ctx.self.name}". You are not in the target list and can never target yourself.`,
    ROLE_GUIDANCE[ctx.role],
    `Your persona (stay in character): ${ctx.persona}.`,
    ctx.allies.length ? `Your fellow werewolves are: ${ctx.allies.map((a) => a.name).join(', ')}. Never betray them.` : '',
    ctx.packPick
      ? `Your pack has already chosen to kill ${ctx.packPick.name} (id: ${ctx.packPick.id}) tonight. Back that choice unless you have a strong reason not to — the pack kills whoever gets the most wolf picks.`
      : '',
    `Phase: ${ctx.phase}, round ${ctx.round}.`,
    ctx.memories.length ? `Your private notes from earlier rounds:\n${ctx.memories.join('\n')}` : '',
    `Public conversation so far:\n${ctx.transcript || '(nothing said yet)'}`,
    ctx.replyTo
      ? `${ctx.replyTo.name} just said: "${ctx.replyTo.text}". Respond to them directly in your speech — answer, push back, or build on it, in character.`
      : '',
    `Players you may target (use their exact id${ctx.phase === 'DAY_VOTE' ? ', or "" to abstain from the vote' : ''}):\n${roster}`,
    task,
    'Reply as JSON with: speech (one or two natural sentences you say aloud; empty at night),',
    'reasoning (your private strategy — this is never shown to opponents), and targetId.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
