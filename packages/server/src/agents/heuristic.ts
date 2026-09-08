import type { Agent, AgentContext, AgentDecision } from './agent';

const SUSPICIONS = [
  (name: string) => `I don't have proof, but ${name} has been acting suspicious.`,
  (name: string) => `Something about ${name} doesn't add up to me.`,
  (name: string) => `I'm leaning toward ${name} — too quiet, too convenient.`,
  (name: string) => `Watch ${name}. My gut says they're hiding something.`,
  (name: string) => `${name} dodged the last accusation. That's a tell.`,
];

const pick = <T>(arr: readonly T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];

/**
 * A no-API agent used as a fallback when GEMINI_API_KEY is absent, and as a
 * test double. It picks a random legal (non-ally) target and varies its speech
 * so games without a real LLM still progress and feel alive.
 */
export class HeuristicAgent implements Agent {
  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const pool = ctx.candidates.filter((c) => !ctx.allies.some((a) => a.id === c.id));
    const target = pick(pool) ?? ctx.candidates[0] ?? null;
    const targetName = target?.name ?? 'no one';
    const reasoning = `As the ${ctx.role} in round ${ctx.round}, my read points at ${targetName}.`;
    const speech = ctx.phase === 'DAY_DISCUSSION' && target ? (pick(SUSPICIONS) ?? (() => ''))(targetName) : '';
    return { speech, reasoning, targetId: target?.id ?? null };
  }
}
