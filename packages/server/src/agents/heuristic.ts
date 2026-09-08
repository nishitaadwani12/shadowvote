import type { Agent, AgentContext, AgentDecision } from './agent';

/**
 * A no-API agent used as a fallback when GEMINI_API_KEY is absent, and as a
 * deterministic test double. It picks the first legal candidate so games always
 * progress to a conclusion without any network calls.
 */
export class HeuristicAgent implements Agent {
  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const target = ctx.candidates[0] ?? null;
    const targetName = target?.name ?? 'no one';
    const reasoning =
      `As the ${ctx.role} in round ${ctx.round}, with little hard evidence I keep pressure on ${targetName}.`;
    const speech =
      ctx.phase === 'DAY_DISCUSSION'
        ? `I don't have proof, but ${targetName} has been acting suspicious. I'm watching them.`
        : '';
    return { speech, reasoning, targetId: target?.id ?? null };
  }
}
