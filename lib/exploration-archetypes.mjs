/**
 * Which design archetypes each exploration count explores. Mirrors the worker
 * truth in `skills/stelow-workflow-interface-alternatives/SKILL.md` (Step 0
 * defaults: 2 → A,D · 3 → A,D,E · 4 → A,B,D,E · 5 → all; count 1 lets the LLM
 * pick the best fit with no hybrid). Two sources by necessity — markdown the
 * worker reads, a module the card renders — so this file is the one's
 * counterpart to keep in step when the other moves, and the test pins the
 * pairing count-by-count.
 */

export const ARCHETYPE_PHILOSOPHY = {
  A: "Conventional Standard — familiar patterns, lowest usability risk.",
  B: "Interaction Paradigm Shift — reframes the mental model itself.",
  C: "Technological Vanguard — advanced tech for a magical experience.",
  D: "Radical Simplicity — everything but the essential interaction, removed.",
  E: "Expert / Command-First — speed and fluency for expert throughput.",
};

export const EXPLORATION_ARCHETYPES = [
  { count: "1", archetypes: [], hybrid: false, note: "One direct direction; the model picks the best-fitting archetype." },
  { count: "2", archetypes: ["A", "D"], hybrid: true, note: "Safe baseline + simplicity." },
  { count: "3", archetypes: ["A", "D", "E"], hybrid: true, note: "Baseline + simplicity + expert flow." },
  { count: "4", archetypes: ["A", "B", "D", "E"], hybrid: true, note: "Adds the paradigm shift." },
  { count: "5", archetypes: ["A", "B", "C", "D", "E"], hybrid: true, note: "The whole library." },
];

/** The archetype letters a count explores, plus hybrid. Empty for count 1 (LLM-chosen). */
export function archetypesForCount(count) {
  const entry = EXPLORATION_ARCHETYPES.find((row) => row.count === String(count));
  return entry ? { archetypes: [...entry.archetypes], hybrid: entry.hybrid } : { archetypes: [], hybrid: false };
}
