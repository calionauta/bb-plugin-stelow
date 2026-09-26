import assert from "node:assert/strict";
import { createGatePreReview } from "../server/review-preflight.ts";

const preset = {
  id: "judge",
  name: "Review judge",
  provider_id: "provider",
  model_id: "model",
  reasoning_level: "high",
  permission_mode: "auto",
  environment_kind: "project-default",
  base_branch: null,
  machine_id: null,
  instructions: "",
  is_default: 0,
  built_in: 0,
  created_at: 0,
  updated_at: 0,
};

const fenced = (value) => `reasoning\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

function card() {
  return {
    id: "card_1",
    project_id: "prj_1",
    name: "Card",
    display_name: "Card",
    prompt: "Build the thing",
    intent: "build",
    status: "in-progress",
    stage: "gate",
    activity: "running",
    worker_thread_id: "thr_worker",
    worker_preset_id: null,
    preset_restart_pending: null,
    dir_hash: "hash_1",
    auto_continue_count: null,
    auto_continue_stage: null,
    spawn_retry_count: null,
    spawn_retry_thread: null,
    attachments: "",
    workspace_kind: "project",
    workspace_path: "/repo",
    workspace_host_id: null,
    kind: "build",
    research_strategy: null,
    research_strategies: null,
    explore_stage: null,
    last_error: null,
    last_assistant_text: null,
    last_idle_at: null,
    environment_label: null,
    created_at: 0,
    updated_at: 0,
  };
}

function preflightBb(calls) {
  return {
    sdk: {
      files: { read: async () => ({ content: "A complete artifact with scope." }) },
      threads: {
        get: async () => ({ status: "idle" }),
        output: async () => ({
          output: fenced({
            verdict: "needs-revision",
            findings: [{
              criterion: "scope",
              quote: "A complete artifact",
              verdict: "FAIL",
              repair: "Add detail",
            }],
          }),
        }),
      },
    },
    realtime: { publish: (...args) => calls.push(["publish", ...args]) },
  };
}

function preflightHarness(reviewable) {
  const calls = [];
  const bb = preflightBb(calls);
  const row = card();
  const runner = createGatePreReview({
    bb,
    getCard: () => row,
    getReviewPresetId: () => "judge",
    getPresetById: () => preset,
    presetAttachmentParams: () => ({
      providerId: "provider",
      modelId: "model",
      reasoningLevel: "high",
      permissionMode: "auto",
      environmentKind: "project-default",
      baseBranch: null,
      machineId: null,
      instructions: "",
    }),
    cardWorkspace: async () => ({ path: "/repo" }),
    boardFromRoot: async () => ({
      workflows: [{ id: "hash_1", artifacts: [{ kind: "product-spec", path: "spec.md" }] }],
    }),
    spawnDisposable: async (args, site) => {
      calls.push(["spawn", args, site]);
      return { id: "thr_review" };
    },
    stopThread: async (id) => calls.push(["stop", id]),
    logCardComment: (...args) => {
      calls.push(["comment", ...args]);
      return "cmt_1";
    },
    sleep: async () => undefined,
    reviewable,
  });
  return { calls, runner };
}

{
  let reviewedPath = null;
  const { calls, runner } = preflightHarness((path, content) => {
    reviewedPath = path;
    return content.length > 10;
  });
  await runner("card_1", "gate");
  assert.equal(reviewedPath, "spec.md", "artifact contracts use the manifest-relative path");
  assert.equal(calls[0][0], "spawn");
  assert.equal(calls[0][2], "review", "pre-review keeps the registered delegation site");
  assert.equal(calls[0][1].visibility, "hidden");
  assert.ok(calls.some(([name]) => name === "stop"), "the advisory review always stops");
  assert.ok(calls.some(([name]) => name === "comment"), "findings leave an openable trail");
}

{
  const { calls, runner } = preflightHarness(() => false);
  await runner("card_1", "gate");
  assert.deepEqual(calls, [], "thin artifacts never spend review budget");
}

console.log("review preflight test ok: relative contracts, cleanup, trail, and budget refusal");
