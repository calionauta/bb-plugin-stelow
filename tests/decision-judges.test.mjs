import assert from "node:assert/strict";
import { createPresetJudgeRunner } from "../server/decisions/preset-judge-runner.ts";
import { createArtifactCriteriaJudge } from "../server/decisions/artifact-criteria-judge.ts";
import { createScoredBatchJudge } from "../server/decisions/scored-batch-judge.ts";
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

function runnerHarness({
  now = () => 1_000,
  spawn,
  status = "idle",
  output = '{"ok":true}',
  getPresetById = () => preset,
} = {}) {
  const calls = [];
  const bb = {
    sdk: {
      threads: {
        spawn: spawn ?? (async (args) => {
          calls.push(["spawn", args]);
          return { id: "thr_judge" };
        }),
        get: async () => ({ status }),
        output: async () => ({ output }),
        stop: async (args) => calls.push(["stop", args]),
        archive: async (args) => calls.push(["archive", args]),
      },
    },
  };
  return { calls, runner: createPresetJudgeRunner({ bb, getPresetById, now }) };
}

{
  const { calls, runner } = runnerHarness();
  const result = await runner({
    presetId: "judge",
    projectId: "prj_1",
    title: "Judge",
    prompt: "Question",
  });
  assert.deepEqual(result, { ok: true, text: '{"ok":true}', error: null });
  assert.equal(calls[0][1].visibility, "hidden");
  assert.deepEqual(calls.slice(1), [
    ["stop", { threadId: "thr_judge" }],
    ["archive", { threadId: "thr_judge" }],
  ]);
}

{
  const { calls, runner } = runnerHarness({
    now: (() => {
      let value = 0;
      return () => (value += 200_000);
    })(),
    status: "running",
  });
  const result = await runner({
    presetId: "judge",
    projectId: "prj_1",
    title: "Judge",
    prompt: "Question",
  });
  assert.deepEqual(result, { ok: false, text: null, error: "Preset judge timed out." });
  assert.deepEqual(calls.slice(1), [
    ["stop", { threadId: "thr_judge" }],
    ["archive", { threadId: "thr_judge" }],
  ]);
}

{
  const { calls, runner } = runnerHarness({ getPresetById: () => null });
  const result = await runner({
    presetId: "missing",
    projectId: "prj_1",
    title: "Judge",
    prompt: "Question",
  });
  assert.deepEqual(result, {
    ok: false,
    text: null,
    error: 'Unknown preset "missing".',
  });
  assert.deepEqual(calls, [], "an unknown preset never spends a turn");
}

{
  const { calls, runner } = runnerHarness();
  const result = await runner({
    presetId: "judge",
    projectId: null,
    title: "Judge",
    prompt: "Question",
  });
  assert.deepEqual(result, {
    ok: false,
    text: null,
    error: "Preset judging needs a project.",
  });
  assert.deepEqual(calls, [], "a preset without a project never spends a turn");
}

const criteriaSkill = `criteria:
  - id: risks
    kind: semantic
    text: "Risks name mitigations"
`;
const fenced = (value) => `reasoning\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
{
  let prompt = "";
  const judgePresetCriteria = createArtifactCriteriaJudge(async (args) => {
    prompt = args.prompt;
    return {
      ok: true,
      text: fenced({ verdicts: [
        { id: "risks", status: "met", confidence: 0.8 },
        { id: "invented", status: "met", confidence: 1 },
      ] }),
      error: null,
    };
  });
  const result = await judgePresetCriteria({
    presetId: "judge",
    projectId: "prj_1",
    skillText: criteriaSkill,
    artifactText: "artifact",
    routeAt: 0.8,
  });
  assert.equal(result.ok, true);
  assert.equal(result.evaluated, 1, "unknown criterion ids never become findings");
  assert.equal(result.findings[0].verdict, "met");
  assert.match(prompt, /\[risks\] Risks name mitigations/);
}

{
  const judgePresetCriteria = createArtifactCriteriaJudge(async () => ({
    ok: true,
    text: fenced({
      verdicts: [
        { id: "risks", status: "met", confidence: 0.79 },
      ],
    }),
    error: null,
  }));
  const result = await judgePresetCriteria({
    presetId: "judge",
    projectId: "prj_1",
    skillText: criteriaSkill,
    artifactText: "artifact",
    routeAt: 0.8,
  });
  assert.equal(
    result.findings[0].verdict,
    "unverifiable",
    "low-confidence met verdicts never pass the criteria gate",
  );
}

{
  const judgePresetCriteria = createArtifactCriteriaJudge(async () => ({
    ok: true,
    text: fenced({ verdicts: [] }),
    error: null,
  }));
  const result = await judgePresetCriteria({
    presetId: "judge",
    projectId: "prj_1",
    skillText: criteriaSkill,
    artifactText: "artifact",
    routeAt: 0.8,
  });
  assert.deepEqual(result, {
    ok: false,
    findings: [],
    evaluated: 0,
    error: "judge verdicts match no known criteria",
  });
}

const batchBase = {
  questions: { "task:first": {}, "task:second": {} },
  keyPrefix: "task",
  state: "diff",
  mode: "api",
  presetId: null,
  projectId: "prj_1",
  title: "Judge tasks",
  provider: "jev",
  endpoint: "https://decision.test",
  apiKey: "secret",
  model: "model",
  routeAt: 0.7,
};
{
  const calls = [];
  const judgeScoredBatch = createScoredBatchJudge(async () => {
    throw new Error("preset path must stay cold in api mode");
  }, async (args) => {
    const id = Object.keys(args.questions)[0].split(":")[1];
    calls.push(id);
    await new Promise((resolve) => setTimeout(resolve, id === "first" ? 5 : 0));
    return {
      ok: true,
      answers: {
        [Object.keys(args.questions)[0]]: {
          type: "score",
          score: id === "first" ? 2 : 0,
          confidence: 0.9,
        },
      },
    };
  });
  const result = await judgeScoredBatch({
    ...batchBase,
    items: [{ id: "first" }, { id: "second" }],
  });
  assert.deepEqual(calls, ["first", "second"]);
  assert.deepEqual(result.findings.map(({ id, verdict }) => [id, verdict]), [
    ["first", "met"],
    ["second", "unmet"],
  ]);
}

{
  const judgeScoredBatch = createScoredBatchJudge(async () => ({
    ok: true,
    text: fenced({ verdicts: [
      { id: "first", status: "met", confidence: 0.4 },
    ] }),
    error: null,
  }));
  const missingPreset = await judgeScoredBatch({
    ...batchBase,
    mode: "preset",
    items: [{ id: "first" }],
  });
  assert.deepEqual(missingPreset, {
    ok: false,
    error: "preset mode needs a judge preset",
  });
}

{
  const judgeScoredBatch = createScoredBatchJudge(async () => {
    return {
      ok: true,
      text: fenced({
        verdicts: [
          { id: "second", status: "unmet", confidence: 0.9 },
          { id: "first", status: "met", confidence: 0.4 },
        ],
      }),
      error: null,
    };
  });
  const result = await judgeScoredBatch({
    ...batchBase,
    mode: "preset",
    presetId: "judge",
    items: [
      { id: "first", text: "first" },
      { id: "second", text: "second" },
    ],
  });
  assert.deepEqual(result.findings.map(({ id, verdict }) => [id, verdict]), [
    ["first", "unverifiable"],
    ["second", "unmet"],
  ]);
}

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
  const { calls, runner } = preflightHarness((_path, content) => content.length > 10);
  await runner("card_1", "gate");
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

console.log("decision judges test ok: cleanup, refusal, confidence, ordering, and preflight controls");
