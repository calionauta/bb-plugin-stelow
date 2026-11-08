import assert from "node:assert/strict";
import { createCardDetailHandler } from "../server/runtime/card-detail.ts";

// Behavior first: the card detail is the surface that paints the stage
// timeline, and the timeline's skips are only correct when the config parse
// and the skip resolution agree. tests/stage-skips.test.mjs exercises
// skippedStages() directly with good inputs; nothing pins the assembly path
// below (state.md -> parseWorkflowConfig -> assembleDetail). A regression
// there paints no plan-gate/diff-gate skip, ever, while every unit test stays
// green — the exact failure from the run-knobs migration.

// One fake db that answers every prepare() the way production answers a
// mid-migration ledger: rows may be missing, statements must not throw.
const emptyDb = {
  prepare() {
    return { get() { return undefined; }, all() { return []; } };
  },
};

function probeCard(intent) {
  return {
    id: "card_skips_probe",
    kind: "build",
    intent,
    stage: "planning",
    status: "in-progress",
    name: "probe",
    prompt: "probe",
    project_id: "p1",
    dir_hash: "abc123",
    worker_thread_id: "thr-1",
    activity: "running",
    last_error: null,
    accepted_at: null,
    workspace_kind: "project",
    workspace_path: "/repo",
    environment_label: null,
    research_strategy: null,
    explore_stage: null,
    worker_preset_id: null,
    preset_restart_pending: 0,
    updated_at: 0,
    last_idle_at: 0,
    read_miss_since: null,
  };
}

function depsFor(stateMd, card) {
  return {
    db: emptyDb,
    bb: {
      sdk: {
        files: {
          async read({ path }) {
            return path.endsWith("state.md") ? { content: stateMd } : null;
          },
        },
        threads: {
          async get() {
            return { environmentId: null };
          },
        },
      },
    },
    now: () => 0,
    idleAttentionMs: 0,
    getCard: () => card,
    cardWorkspace: async () => ({ path: "/repo", hostId: null }),
    syncThreadState: async () => undefined,
    fetchPendingQuestions: async () => [],
    resolveAskOptions: async (_card, options) => options,
    cardAttachments: () => [],
    detectMentionedFiles: async () => [],
    workspaceRelative: () => null,
    parseNextStages: () => [],
    getReliablePreset: () => ({ id: "p", name: "n", provider_id: null, model_id: null }),
    strategyList: () => [],
    flowTimes: () => ({ leadMs: null, cycleMs: null }),
    verifiedHeadSha: () => null,
    workers: { history: async () => [] },
    executionLifecycle: { detailList: () => [] },
    stalenessForQuestions: async () => new Map(),
    stateDir: async () => "/repo/.stelow/2026-01-01/abc123",
    scopeXray: async () => null,
    fileTimestamp: () => "",
    auditReceiptNote: () => null,
    cardNotFound: "not found",
  };
}

function detailFor({ stateMd, intent = "feature" }) {
  const card = probeCard(intent);
  return createCardDetailHandler(depsFor(stateMd, card))({ cardId: card.id });
}

function stateWithConfig(config) {
  return `---\nworkflow_id: w-probe\nintent: feature\ncurrent_stage: planning\nstatus: active\nconfig:\n${config}\n---\n`;
}

const skippedOf = (detail) => detail.stageSkips.skipped.map((entry) => entry.stage).sort();

const auto = await detailFor({
  stateMd: stateWithConfig("  appetite: Core\n  review_mode: Auto"),
});
assert.deepEqual(
  skippedOf(auto),
  ["diff-gate", "plan-gate", "selection"],
  "an Auto card paints its plan-gate, diff-gate and selection skips through the assembly path",
);

const strictest = await detailFor({
  stateMd: stateWithConfig(
    "  appetite: Core\n  review_mode: Product Spec + Interface + Tech Review + Code Diff",
  ),
});
assert.deepEqual(skippedOf(strictest), [], "the strictest route invents no skips on the detail");

const legacy = await detailFor({
  stateMd: stateWithConfig("  appetite: Lean\n  review_mode: Auto"),
});
assert.ok(
  skippedOf(legacy).includes("plan-gate"),
  "an appetite-only legacy state still resolves skips (the parse path, not a hardcoded default, is in play)",
);

const explicitGates = await detailFor({
  stateMd: stateWithConfig("  appetite: Core\n  review_gates: [spec]"),
});
assert.ok(
  skippedOf(explicitGates).includes("plan-gate"),
  "an explicit review_gates set resolves skips without any ladder string",
);

console.log("card detail stage skips test ok: Auto, strictest, legacy appetite, explicit gates");
