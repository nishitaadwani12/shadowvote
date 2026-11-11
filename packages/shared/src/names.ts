/**
 * Natural first names for AI players. AIs used to be called "AI-1", "AI-2"…
 * while humans typed a real name, so the models could trivially single out the
 * human ("X is a human player") and gang up on them. Giving AIs ordinary names
 * keeps the table anonymous to the agents.
 */
export const AI_NAMES = [
  'Aarav', 'Meera', 'Kabir', 'Isha', 'Rohan', 'Tara', 'Vikram', 'Anaya',
  'Leo', 'Maya', 'Arjun', 'Zara', 'Dev', 'Nora', 'Kian', 'Riya',
  'Sam', 'Ava', 'Neil', 'Lena', 'Omar', 'Priya', 'Theo', 'Sana',
] as const;

/**
 * Picks a name not already used at the table (case-insensitive), so an AI
 * never shares a name with the human or another AI. Falls back to a numbered
 * name only if the whole pool is taken.
 */
export function pickAiName(taken: readonly string[], random: () => number = Math.random): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const free = AI_NAMES.filter((n) => !used.has(n.toLowerCase()));
  if (free.length) return free[Math.floor(random() * free.length)]!;
  let i = 1;
  while (used.has(`player ${i}`)) i++;
  return `Player ${i}`;
}
