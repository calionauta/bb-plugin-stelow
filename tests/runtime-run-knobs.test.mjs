// Behavior: seeding writes the run knobs and the deprecated alias the upstream
// helper writes, and the board resolves a stored legacy appetite exactly as the
// state parser does. Both surfaces used to answer one datum with two rules.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boardFromRoot } from "../server/runtime/board-read.ts";
import { seedWorkflow } from "../server/runtime/workflow-seeding.ts";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";
import { STATE_TEMPLATE } from "../lib/state-template.mjs";

const diskFiles = {
  read: async ({ path: target }) => ({ content: fs.readFileSync(target, "utf8") }),
};

// The write-side alias follows the helper's table, which is NOT the read map:
// 1 and 4 are lossy on read, but every breadth still writes the alias an old
// host expects. One workspace per breadth keeps each seed independent.
const ALIASES = [
  [1, "Lean"],
  [2, "Lean"],
  [3, "Core"],
  [4, "Complete"],
  [5, "Complete"],
];

async function seedInFreshWorkspace(count) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "stelow-knobs-"));
  const seeded = await seedWorkflow(
    { sdk: { files: diskFiles } },
    workspace,
    `card_knobs_${count}`,
    `Knobs ${count}`,
    "feature",
    {
      quality: "production",
      explorationCount: count,
      explorationHybrid: count >= 2,
    },
    "Auto",
  );
  assert.equal(seeded.error, null, `breadth ${count} seeds`);
  const state = fs.readFileSync(seeded.statePath, "utf8");
  const tracking = JSON.parse(
    fs.readFileSync(path.join(workspace, "stelow.json"), "utf8"),
  );
  return { workspace, state, tracking };
}

// --- seeding writes the alias the helper writes, never in the template ---
assert.doesNotMatch(
  STATE_TEMPLATE,
  /^  appetite:/m,
  "the canonical template stays free of the alias; only the seeded body carries it",
);

for (const [count, alias] of ALIASES) {
  const { workspace, state, tracking } = await seedInFreshWorkspace(count);
  assert.match(
    state,
    new RegExp(`appetite: ${alias} {2}# DEPRECATED alias, knobs above are canonical`),
    `breadth ${count} writes the ${alias} alias the helper writes`,
  );
  assert.equal(
    tracking.workflows[0].config.appetite,
    alias,
    `breadth ${count} tracking carries ${alias}`,
  );
  if (count === 2 || count === 3 || count === 5) {
    assert.equal(
      parseWorkflowConfig(state).explorationCount,
      count,
      `breadth ${count} round-trips through the reader`,
    );
  }
  fs.rmSync(workspace, { recursive: true, force: true });
}

// --- board run knobs: the row and the parser answer the same question ---
// The board reads stelow.json, whose config may predate the knobs. A legacy
// appetite must resolve exactly as parseWorkflowConfig resolves it, or the
// board and the card detail disagree about one datum.
const boardWithConfig = (config) =>
  boardFromRoot(
    {
      sdk: {
        files: {
          read: async ({ path: target }) => {
            if (target.endsWith("stelow.json")) {
              const entry = {
                workflowId: "card_knobs",
                dirHash: "sw-knobs",
                created: "2026-01-02T00:00:00.000Z",
                name: "Knobs",
                status: "in-progress",
                ...(config ? { config } : {}),
              };
              return { content: JSON.stringify({ workflows: [entry] }) };
            }
            return { content: "" };
          },
          listPaths: async () => ({ paths: [] }),
        },
      },
    },
    "/w",
  );

const legacyRow = (await boardWithConfig({ appetite: "Lean" })).workflows[0];
const legacyParse = parseWorkflowConfig("config:\n  appetite: Lean");
assert.equal(legacyRow.quality, legacyParse.quality, "the board and the parser agree on legacy quality");
assert.equal(legacyRow.explorationCount, 2, "a legacy Lean appetite reports breadth 2 on the board");
assert.equal(
  legacyRow.explorationCount,
  legacyParse.explorationCount,
  "the board and the parser agree on legacy breadth",
);
assert.equal(
  legacyRow.explorationHybrid,
  legacyParse.explorationHybrid,
  "the board and the parser agree on the legacy hybrid flag",
);

const knobRow = (
  await boardWithConfig({
    quality: "experimental",
    exploration_count: 4,
    exploration_hybrid: false,
  })
).workflows[0];
assert.equal(knobRow.quality, "experimental", "a declared quality wins on the board");
assert.equal(knobRow.explorationCount, 4, "a declared breadth wins on the board");
assert.equal(knobRow.explorationHybrid, false, "a declared hybrid flag wins on the board");

const defaultRow = (await boardWithConfig(null)).workflows[0];
assert.equal(defaultRow.quality, "production", "no config reports the documented quality default");
assert.equal(defaultRow.explorationCount, 3, "no config reports the documented breadth default");
assert.equal(defaultRow.explorationHybrid, true, "no config reports the documented hybrid default");

console.log("run knobs behavior ok: seeded alias, tracking entry, and board/parser agreement");
