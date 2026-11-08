import assert from "node:assert/strict";
import { ARCHETYPE_PHILOSOPHY, EXPLORATION_ARCHETYPES, archetypesForCount } from "../lib/exploration-archetypes.mjs";

// The pairing the worker executes (SKILL.md Step 0 defaults): count 1 is
// LLM-chosen with no hybrid; 2-5 add the hybrid and grow A,D -> A,D,E ->
// A,B,D,E -> all. Five archetypes, five letters, no sixth.
assert.deepEqual(archetypesForCount("1"), { archetypes: [], hybrid: false });
assert.deepEqual(archetypesForCount("2"), { archetypes: ["A", "D"], hybrid: true });
assert.deepEqual(archetypesForCount("3"), { archetypes: ["A", "D", "E"], hybrid: true });
assert.deepEqual(archetypesForCount("4"), { archetypes: ["A", "B", "D", "E"], hybrid: true });
assert.deepEqual(archetypesForCount("5"), { archetypes: ["A", "B", "C", "D", "E"], hybrid: true });
assert.deepEqual(archetypesForCount("9"), { archetypes: [], hybrid: false });

// Every letter used has a one-line philosophy, and every philosophy belongs
// to a letter the table can actually serve.
const used = new Set(EXPLORATION_ARCHETYPES.flatMap((row) => row.archetypes));
assert.deepEqual([...used].sort(), ["A", "B", "C", "D", "E"]);
for (const letter of used) {
  assert.ok(ARCHETYPE_PHILOSOPHY[letter]?.length > 0, `${letter} has a philosophy line`);
}
assert.deepEqual(Object.keys(ARCHETYPE_PHILOSOPHY).sort(), ["A", "B", "C", "D", "E"]);

console.log("exploration-archetypes: ok");
