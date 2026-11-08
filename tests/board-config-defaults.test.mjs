import assert from "node:assert/strict";
import { boardFromRoot } from "../server/runtime/board-read.ts";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";

// Behavior first: the board and the card detail answer the same question
// (what run knobs does this workflow run on?) from two different reads —
// stelow.json for the board, state.md for the detail. The defaults when a
// config is absent/legacy must not carry two answers for the same datum —
// board row's quality/explorationCount/explorationHybrid must match what
// parseWorkflowConfig assumes for the equivalent state blob.

const apiWithTracking = (tracking) => ({
  sdk: {
    files: {
      async read({ path }) {
        if (path.endsWith("stelow.json")) return { content: JSON.stringify(tracking) };
        return null;
      },
      async listPaths() {
        return [];
      },
    },
  },
});

const entry = (config) => ({
  name: "probe",
  dirHash: "abc123",
  created: "2026-01-01",
  status: "active",
  config,
});

async function boardRow(config) {
  const board = await boardFromRoot(
    apiWithTracking({ workflows: [entry(config)] }),
    "/repo",
  );
  assert.equal(board.workflows.length, 1, "the entry lists one board row");
  return board.workflows[0];
}

const empty = await boardRow({});
const emptyParsed = parseWorkflowConfig("config:\n");
assert.equal(empty.quality, emptyParsed.quality, "no-config default quality agrees with parseWorkflowConfig");
assert.equal(empty.explorationCount, emptyParsed.explorationCount, "no-config default explorationCount agrees with parseWorkflowConfig");
assert.equal(empty.explorationHybrid, emptyParsed.explorationHybrid, "no-config default explorationHybrid agrees with parseWorkflowConfig");

const legacyState = "config:\n  appetite: Lean\n";
const legacy = await boardRow({ appetite: "Lean" });
const legacyParsed = parseWorkflowConfig(legacyState);
assert.equal(legacy.quality, legacyParsed.quality, "legacy appetite quality resolves through the same map");
assert.equal(legacy.explorationCount, legacyParsed.explorationCount, "legacy appetite explorationCount resolves through the same map");
assert.equal(
  legacy.reviewMode,
  parseWorkflowConfig(legacyState).reviewMode,
  "an appetite-only entry falls back to the same review mode parseWorkflowConfig assumes",
);

const declared = await boardRow({ quality: "experimental", exploration_count: 4, exploration_hybrid: false, review_mode: "Auto" });
assert.equal(declared.quality, "experimental", "a declared quality wins over any default");
assert.equal(declared.explorationCount, 4, "declared exploration count wins over any default");
assert.equal(declared.explorationHybrid, false, "declared hybrid wins over any default");

console.log("board config defaults test ok: empty, legacy-only, and declared configs agree with parse");
