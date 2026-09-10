import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { INTENT_ROUTES, MODE_SKIPS, skippedStages } from "../lib/stage-skips.mjs";
import { STAGE_SEQUENCE } from "../lib/artifact-groups.mjs";

const FULL = ["triage", "select", "setup", "context", "shape", "critique", "gate", "scope", "interface", "int-gate", "selection", "planning", "plan-gate", "execution", "verification", "diff-gate", "audit"];

// Strictest mode runs every gate (diff-gate included) — only context stays
// skipped there, per the gate table. A missing review mode fails open.
assert.deepEqual(
  skippedStages({ kind: "build", intent: "feature", reviewMode: "Product Spec + Interface + Tech Review + Code Diff", sequence: STAGE_SEQUENCE }).skipped.map((s) => s.stage),
  ["context"],
  "strictest mode skips only context",
);

// Auto skips plan-gate, diff-gate, selection — with reasons naming the mode.
{
  const { skipped, offRoute } = skippedStages({ kind: "build", intent: "feature", reviewMode: "Auto", sequence: STAGE_SEQUENCE });
  assert.deepEqual(skipped.map((s) => s.stage).sort(), ["diff-gate", "plan-gate", "selection"], "auto skips");
  assert.ok(skipped.every((s) => s.reason.includes("Auto")), "reasons name the mode");
  assert.deepEqual(offRoute, [], "full route has no off-route stages");
}

// Bugfix route excludes interface/planning machinery (off route, not skipped).
{
  const { offRoute, skipped } = skippedStages({ kind: "build", intent: "bugfix", reviewMode: "Auto", sequence: STAGE_SEQUENCE });
  assert.deepEqual(offRoute.sort(), ["diff-gate", "int-gate", "interface", "plan-gate", "planning", "scope", "selection"], "bugfix off-route set");
  assert.ok(!skipped.some((s) => s.stage === "diff-gate"), "off-route stages are never also skipped");
}

// Unknown intent (pre-triage) and unknown modes fail open: no invented skips.
assert.deepEqual(skippedStages({ kind: "build", intent: "unknown", reviewMode: "Auto", sequence: STAGE_SEQUENCE }), { offRoute: [], skipped: [] }, "unknown intent invents nothing");
assert.deepEqual(skippedStages({ kind: "build", intent: "feature", reviewMode: "Bogus", sequence: STAGE_SEQUENCE }), { offRoute: [], skipped: [] }, "unknown mode invents nothing");
assert.deepEqual(skippedStages({ kind: "research", intent: "investigate", reviewMode: "Auto", sequence: STAGE_SEQUENCE }), { offRoute: [], skipped: [] }, "non-build tracks are empty");

// Cross-check: INTENT_ROUTES and MODE_SKIPS match the vendored methodology
// source (transitions.md stub routes + gate table). Upstream edits fail here,
// loudly, instead of drifting the timeline silently.
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const transitions = readFileSync(join(root, "skills/stelow-workflow-orchestrator/references/transitions.md"), "utf8");
  for (const [intent, route] of Object.entries(INTENT_ROUTES)) {
    const line = transitions.split("\n").find((l) => l.startsWith(`**${intent}:**`));
    assert.ok(line, `stub route for ${intent} exists in transitions.md`);
    const expected = line.split("**")[2].split("→").map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(route, expected, `route for ${intent} matches transitions.md`);
  }
  for (const [stage, modes] of Object.entries(MODE_SKIPS)) {
    if (stage === "selection") {
      // Selection skips live in human-gates + the interface skill (LLM
      // decides in Auto / Product Spec Gate), not the gate table.
      const gates = readFileSync(join(root, "skills/stelow-workflow-orchestrator/references/human-gates.md"), "utf8");
      assert.ok(/Auto.*Product Spec Gate.*LLM decides|LLM decides.*Auto/i.test(gates), "human-gates documents LLM-decided selection");
      continue;
    }
    for (const mode of modes) {
      const row = new RegExp(`^\\| ${stage} \\| ${mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| skip \\|`, "m");
      assert.ok(row.test(transitions), `gate table skips ${stage} in ${mode}`);
    }
  }
  assert.deepEqual(FULL.sort(), [...STAGE_SEQUENCE].sort(), "test route baseline matches canonical sequence");
}

console.log("stage skips test ok: rules, fail-opens, transitions.md cross-check");
