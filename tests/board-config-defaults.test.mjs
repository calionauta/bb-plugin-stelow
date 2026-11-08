import assert from "node:assert/strict";
import { boardFromRoot } from "../server/runtime/board-read.ts";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";

// Behavior first: the board and the card detail answer the same question
// ("what appetite does this workflow have?") from two different reads —
// stelow.json for the board, state.md for the detail. When the config is
// absent or legacy-shaped, the two defaults disagreed (board "Core" vs
// parse "Lean"), so one workflow wore two appetites depending on which
// surface you opened. The board must not own a second default.

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
assert.equal(
  empty.appetite,
  parseWorkflowConfig("config:\n").appetite,
  "a workflow with no config shows the same appetite on the board as parseWorkflowConfig assumes",
);

const legacy = await boardRow({ appetite: "Lean" });
assert.equal(legacy.appetite, "Lean", "an appetite-only entry surfaces its appetite");
assert.equal(
  legacy.reviewMode,
  parseWorkflowConfig("config:\n  appetite: Lean\n").reviewMode,
  "an appetite-only entry falls back to the same review mode parseWorkflowConfig assumes",
);

const declared = await boardRow({ appetite: "Complete", review_mode: "Auto" });
assert.equal(declared.appetite, "Complete", "a declared appetite wins over any default");
assert.equal(declared.reviewMode, "Auto", "a declared review mode wins over any default");

console.log("board config defaults test ok: empty, legacy-only, and declared configs agree with parse");
