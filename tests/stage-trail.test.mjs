import assert from "node:assert/strict";

import { parseStageTrail, renderStageTrail } from "../lib/stage-trail.mjs";

/**
 * The bundle has to carry where the card had been.
 *
 * A bundle copied the artifacts and dropped the stage history, so a reader could
 * see what the card produced and not which stages it entered or when — no bundle
 * could be replayed against the route its intent declares. `state.md` already
 * records every stage it left (`history: - stage: x / at: t / status: done`) and
 * the stage it is on now; this turns that into entry/exit pairs.
 *
 * The exit of one stage IS the entry of the next: the same advance writes both.
 * Getting that off by one would put every stage's time on its neighbour, which is
 * worse than no trail at all, so the boundary cases below are the test.
 */

const STATE = [
  "---",
  "name: trail",
  "current_stage: setup",
  "history:",
  "  - stage: triage",
  "    at: 2026-10-01T10:00:00Z",
  "    status: done",
  "  - stage: select",
  "    at: 2026-10-01T10:05:00Z",
  "    status: done",
  "---",
].join("\n");

const trail = parseStageTrail(STATE);

assert.deepEqual(trail.map((entry) => entry.stage), ["triage", "select", "setup"]);
assert.deepEqual(trail, [
  { stage: "triage", enteredAt: null, leftAt: "2026-10-01T10:00:00Z" },
  { stage: "select", enteredAt: "2026-10-01T10:00:00Z", leftAt: "2026-10-01T10:05:00Z" },
  { stage: "setup", enteredAt: "2026-10-01T10:05:00Z", leftAt: null },
], "the exit of a stage is the entry of the next, and the current stage is still open");

// A card that never advanced has one open stage, not an empty trail.
assert.deepEqual(parseStageTrail("---\ncurrent_stage: triage\nhistory: []\n---\n"), [
  { stage: "triage", enteredAt: null, leftAt: null },
]);
// Off-shape input is an empty trail, never a throw: export reads state files that
// may be hand-broken, and a crash there would fail the bundle instead of the row.
assert.deepEqual(parseStageTrail(null), []);
assert.deepEqual(parseStageTrail(""), []);
// The current stage is not duplicated when the history already ends on it.
assert.deepEqual(
  parseStageTrail("---\ncurrent_stage: triage\nhistory:\n  - stage: triage\n    at: 2026-10-01T10:00:00Z\n---\n")
    .map((entry) => entry.stage),
  ["triage"],
);

const rendered = renderStageTrail(trail);
assert.ok(rendered[0] === "## Stage trail", "the section has one heading, the one the audit reads");
assert.match(rendered.join("\n"), /\| setup \| 2026-10-01T10:05:00Z \| — \|/, "an open stage renders its exit as unknown");
assert.deepEqual(renderStageTrail([]), [], "no history renders no section");
assert.deepEqual(renderStageTrail(undefined), [], "an absent trail renders no section");

console.log(`stage trail ok: ${trail.length} stages, exit of one is the entry of the next`);
