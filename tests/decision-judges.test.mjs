import assert from "node:assert/strict";
import { createPresetJudgeRunner } from "../server/decisions/preset-judge-runner.ts";
import { createArtifactCriteriaJudge } from "../server/decisions/artifact-criteria-judge.ts";
import { createScoredBatchJudge } from "../server/decisions/scored-batch-judge.ts";

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

console.log("decision judges test ok: cleanup, refusal, confidence, and ordering");
