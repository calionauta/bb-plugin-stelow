import assert from "node:assert/strict";
import test from "node:test";
import { createInspectionCommand } from "../server/runtime/cli-inspection.ts";
import { OWNERSHIP_UNVERIFIED } from "../lib/ownership-refusal.mjs";
import { workspaceUnavailable } from "../lib/workspace-refusal.mjs";

const card = {
  id: "card-1",
  kind: "build",
  stage: "triage",
  status: "in-progress",
  dir_hash: "hash-1",
  research_strategy: null,
  explore_stage: null,
};

const baseDeps = {
  skillsDir: "/plugin/skills",
  errors: { archived: "archived", workspace: "workspace unavailable" },
  getCard: () => card,
  getCardForThread: () => card,
  cardWorkspace: async () => ({ path: "/workspace" }),
  loadBoard: async () => ({
    workflows: [{ name: "one", status: "active", stage: "triage" }],
  }),
  boardFromRoot: async () => ({
    workflows: [{ name: "one", status: "active", stage: "triage" }],
  }),
  projectRoot: async () => "/workspace",
  workflowStateDir: async () => "/workspace/.stelow/card-1",
  ensureProjectArtifacts: async () => null,
  openQuestionsByCard: async () => new Map(),
  runHelper: async (args) => ({ code: 0, stdout: args.join(" "), stderr: "" }),
  readText: async () => "current_stage: execution\n",
  researchStrategySkill: () => null,
  exploreTechnique: () => null,
  // No run named, so the playbook prints no run rows — the shape every
  // pre-native install has, and the case a null must stay silent for.
  latestRunForStage: () => null,
  listRunFiles: async () => [],
};

function deps(overrides = {}) {
  return { ...baseDeps, ...overrides };
}

test("inspection family returns status and routes schema through the helper", async () => {
  const run = createInspectionCommand(deps());
  const status = await run(["status", "--json"], {});
  const schema = await run(["schema", "ask"], { projectId: "project-1" });

  assert.equal(status.exitCode, 0);
  assert.equal(JSON.parse(status.stdout).workflows[0].name, "one");
  assert.deepEqual(schema, { exitCode: 0, stdout: "schema ask", stderr: "" });
});

test("inspection family preserves playbook state and doctor ownership inputs", async () => {
  const helperCalls = [];
  const run = createInspectionCommand(deps({
    runHelper: async (args, root, stateDir) => {
      helperCalls.push({ args, root, stateDir });
      return { code: 0, stdout: "doctor ok", stderr: "" };
    },
  }));

  const playbook = await run(["playbook", "--card", "card-1"], {});
  const doctor = await run(
    ["doctor", "--json"],
    { projectId: "project-1", threadId: "thread-1" },
  );

  assert.equal(playbook.exitCode, 0);
  assert.match(playbook.stdout, /\/workspace\/\.stelow\/card-1\/state\.md/);
  assert.match(playbook.stdout, /stage\(execution\)/);
  assert.equal(doctor.exitCode, 0);
  assert.deepEqual(helperCalls, [{
    args: ["doctor", "--json"],
    root: "/workspace",
    stateDir: "/workspace/.stelow/card-1",
  }]);
});

// The root and the declared outputs are printed as ONE answer, so they must come
// from ONE run. A card left the board where the newest run belonged to the
// previous stage (verification) while the card already sat in the next (audit);
// asking for the newest run of any stage pairs a `verification` directory with
// `audit` filenames — the archaeology the section exists to end, wearing a
// confident label. The query must therefore be stage-scoped.
// The run-file rows: what a run actually wrote, listed by the host. The declared
// outputs answer "what should be here"; this answers "what is here", which is
// the question that made workers run `find <run> -type f` — 184 of 225 run-dir
// commands across the live threads.
test("playbook lists what a run actually wrote", async () => {
  const withFiles = createInspectionCommand({
    ...deps({}),
    latestRunForStage: () => ({
      artifactRoot: "/workspace/.stelow/card-1/runs/exec_now",
      recipeId: "verification",
    }),
    listRunFiles: async () => ["verification/tests.json", "notes/scratch.md"],
  });
  const listed = await withFiles(["playbook", "--card", "card-1"], {});
  assert.match(
    listed.stdout,
    /run-file: \/workspace\/\.stelow\/card-1\/runs\/exec_now\/notes\/scratch\.md/,
    "a file the run wrote but no recipe declares is still named",
  );
  assert.match(listed.stdout, /run-file: .*verification\/tests\.json/, "declared files appear as present too");

  // A listing that fails must not break the playbook: staging may already be
  // cleaned up, and that is not an error worth a message.
  const broken = createInspectionCommand({
    ...deps({}),
    latestRunForStage: () => ({
      artifactRoot: "/workspace/.stelow/card-1/runs/exec_gone",
      recipeId: "verification",
    }),
    listRunFiles: async () => { throw new Error("gone"); },
  });
  const survived = await broken(["playbook", "--card", "card-1"], {});
  assert.equal(survived.exitCode, 0, "an unlistable run dir degrades instead of failing the playbook");
  assert.match(survived.stdout, /run: \/workspace\/\.stelow\/card-1\/runs\/exec_gone/, "the root is still named");
});

test("playbook pairs the run root with the run that produced it", async () => {
  const asked = [];
  const run = createInspectionCommand({
    ...deps({}),
    latestRunForStage: (cardId, stage) => {
      asked.push([cardId, stage]);
      // Only the card's CURRENT stage has a run. The fixture's state.md says
      // `current_stage: execution`, which is what playbook reads — the card's
      // own `stage` column is not the source here.
      return stage === "execution"
        ? { artifactRoot: "/workspace/.stelow/card-1/runs/exec_now", recipeId: "verification" }
        : null;
    },
  });

  const playbook = await run(["playbook", "--card", "card-1"], {});
  assert.equal(playbook.exitCode, 0);
  assert.deepEqual(asked, [["card-1", "execution"]], "the run query is scoped to the card's stage");
  assert.match(playbook.stdout, /run: \/workspace\/\.stelow\/card-1\/runs\/exec_now/);
  // Outputs come from the RUN's recipe, not the stage's: if those ever disagree
  // the files the run actually wrote are still the ones named.
  assert.match(playbook.stdout, /run-output: \/workspace\/\.stelow\/card-1\/runs\/exec_now\/verification\/tests\.json/);

  // A stage that has never run prints no run rows at all — never a bare output
  // pointing at a directory nothing above it named. Driven through a seam that
  // answers null for every stage, which is what a never-run card looks like.
  const neverRan = createInspectionCommand({ ...deps({}), latestRunForStage: () => null });
  const bare = await neverRan(["playbook", "--card", "card-1"], {});
  assert.equal(bare.exitCode, 0);
  assert.doesNotMatch(bare.stdout, /^run(-output)?: /m, "no run for this stage means no run section");
});

test("inspection family preserves card failure exit codes and usage", async () => {
  const run = createInspectionCommand(deps({
    getCard: () => undefined,
  }));

  assert.deepEqual(await run(["playbook", "--card", "card-1"], {}), {
    exitCode: 2,
    stderr: 'Unknown card "card-1".',
  });
  assert.deepEqual(await run(["doctor", "--json", "extra"], {}), {
    exitCode: 2,
    stderr: "Usage: bb stelow doctor [--project <proj_id>] [--json]",
  });
});

test("inspection family preserves helper and workspace error exits", async () => {
  const helperFailure = createInspectionCommand(deps({
    runHelper: async () => ({ code: 7, stdout: "partial", stderr: "drift" }),
  }));
  const missingRoot = createInspectionCommand(deps({
    projectRoot: async () => null,
  }));

  assert.deepEqual(await helperFailure(["doctor"], { projectId: "project-1" }), {
    exitCode: 7,
    stderr: "drift",
    stdout: "partial",
  });
  assert.deepEqual(await missingRoot(["schema"], { projectId: "project-1" }), {
    exitCode: 1,
    stderr: workspaceUnavailable("bb stelow schema <command> --project <proj_id>"),
  });
});

test("inspection family refuses archived cards and unverified owned state", async () => {
  const archived = createInspectionCommand(deps({
    getCard: () => ({ ...card, status: "archived" }),
  }));
  const unverified = createInspectionCommand(deps({
    workflowStateDir: async () => null,
  }));

  assert.deepEqual(await archived(["playbook", "--card", "card-1"], {}), {
    exitCode: 1,
    stderr: "archived",
  });
  assert.deepEqual(await unverified(["playbook", "--card", "card-1"], {}), {
    exitCode: 1,
    // The shared sentence, not a copy: the client recognises this exact string
    // to decide that a retry cannot help, so a second copy here is the drift.
    stderr: OWNERSHIP_UNVERIFIED,
  });
});

test("inspection dispatcher leaves unrelated commands to the main CLI", async () => {
  const run = createInspectionCommand(deps());

  assert.equal(await run(["ask", "--thread", "thread-1"], {}), null);
});

// Regression pin for card_48uuhus1: a worker with no read-only way to learn
// "is a question already pending?" fired `--question "ping"` at a human to
// find out. `status` is the verb it already runs, so the count lives there.
test("status reports open questions so a worker never has to ask a human", async () => {
  const askedFor = [];
  const run = createInspectionCommand(deps({
    openQuestionsByCard: async (cardIds) => {
      askedFor.push(...cardIds);
      return new Map([["card-1", { expired: 1, live: 2 }]]);
    },
  }));

  const result = await run(["status"], { threadId: "thread-1" });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(askedFor, ["card-1"], "the card behind the thread is the one counted");
  assert.match(result.stdout, /open-questions=3/, "the open question count is visible on the status line");
});

test("status omits the count when the read fails, rather than claiming zero", async () => {
  // A failed live read is UNKNOWN. Rendering 0 would read as "nothing is
  // waiting", which is exactly the wrong thing to tell a worker.
  const run = createInspectionCommand(deps({ openQuestionsByCard: async () => null }));
  const result = await run(["status"], { threadId: "thread-1" });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.stdout, /open-questions/, "an unknown count is never rendered as a number");
  assert.match(result.stdout, /one\tactive\ttriage/, "the rest of the status line still renders");
});

// Every card-context `status` answer carries this board next to whatever the
// helper adds, so the fixture is shared instead of copied into four tests.
const BOARD = { workflows: [{ name: "one", status: "active", stage: "triage" }] };

// `status --json` inside a card thread is what the skills parse to learn
// `current_stage` / `intent` / `config` — the fields only the upstream helper
// knows, because it owns state.md. The host's board stays in the object: a
// worker asking one verb gets one answer instead of a second helper call, and
// the workflow fields are merged ON TOP rather than replacing it.
test("status --json in a card context merges the helper's workflow fields over the board", async () => {
  const helperCalls = [];
  const run = createInspectionCommand(deps({
    runHelper: async (args, root, stateDir) => {
      helperCalls.push({ args, root, stateDir });
      return {
        code: 0,
        stdout: JSON.stringify({
          current_stage: "setup",
          intent: "feature",
          config: { review_mode: "Auto" },
        }),
        stderr: "",
      };
    },
  }));

  const result = await run(["status", "--json"], { threadId: "thread-1" });
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.current_stage, "setup", "the stage the skills read comes from state.md, not the card");
  assert.equal(parsed.intent, "feature");
  assert.equal(parsed.config.review_mode, "Auto");
  assert.equal(parsed.workflows[0].name, "one", "the board is still there, not replaced by the helper's answer");
  // The helper reads the card's own state dir. Pointing it at the workspace
  // root would make it read a different card's state.md, or none at all.
  assert.deepEqual(helperCalls, [{
    args: ["status", "--json"],
    root: "/workspace",
    stateDir: "/workspace/.stelow/card-1",
  }]);
});

test("status in text mode renders the board and never pays for the helper", async () => {
  const helperCalls = [];
  const run = createInspectionCommand(deps({
    runHelper: async (...call) => {
      helperCalls.push(call);
      return { code: 0, stdout: JSON.stringify({ current_stage: "setup" }), stderr: "" };
    },
  }));

  const result = await run(["status"], { threadId: "thread-1" });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(helperCalls, [], "text mode has no field to fill, so the helper is not run");
  assert.match(result.stdout, /one\tactive\ttriage/, "the rendered status line is unchanged");
  assert.doesNotMatch(result.stdout, /current_stage/, "and no JSON leaked into the human rendering");
});

test("status --json keeps the board when the helper fails instead of inventing a stage", async () => {
  const run = createInspectionCommand(deps({
    runHelper: async () => ({ code: 2, stdout: "", stderr: "state.md is missing" }),
  }));

  const result = await run(["status", "--json"], { threadId: "thread-1" });
  assert.equal(result.exitCode, 0, "a failed helper is not a failed status");
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed, BOARD, "the board is returned exactly as built, with nothing merged in");
  assert.equal("current_stage" in parsed, false, "an unreadable stage is unknown, never a guess");
  assert.doesNotMatch(result.stdout, /state\.md is missing/, "the helper's stderr is not smuggled into stdout");
});

test("status --json never reads the project root for a card whose state dir is unowned", async () => {
  const helperCalls = [];
  const run = createInspectionCommand(deps({
    workflowStateDir: async () => null,
    runHelper: async (...call) => {
      helperCalls.push(call);
      return {
        code: 0,
        stdout: JSON.stringify({ current_stage: "someone-elses-stage" }),
        stderr: "",
      };
    },
  }));

  const result = await run(["status", "--json"], { threadId: "thread-1" });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(helperCalls, [], "no state dir means no helper call: root state belongs to another workflow");
  assert.deepEqual(JSON.parse(result.stdout), BOARD, "an unresolved state dir leaves the board untouched");
});

test("status --json survives a helper that throws or answers with garbage", async () => {
  // Both are the same defect in a worker's eyes — the status command died and
  // took the board with it, so the one verb it always has stopped working.
  const throwing = createInspectionCommand(deps({
    runHelper: async () => { throw new Error("spawn failed"); },
  }));
  const garbage = createInspectionCommand(deps({
    runHelper: async () => ({ code: 0, stdout: "not json at all", stderr: "" }),
  }));

  for (const run of [throwing, garbage]) {
    const result = await run(["status", "--json"], { threadId: "thread-1" });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), BOARD);
  }
});

// Outside a card thread there is no state.md and no stage to report, so the
// board is the whole answer. This is the shape every pre-card caller gets.
test("status --json with no card in context returns the board and runs no helper", async () => {
  const helperCalls = [];
  const run = createInspectionCommand(deps({
    loadBoard: async () => BOARD,
    boardFromRoot: async () => {
      throw new Error("no card means no card workspace to build from");
    },
    runHelper: async (...call) => {
      helperCalls.push(call);
      return { code: 0, stdout: JSON.stringify({ current_stage: "setup" }), stderr: "" };
    },
  }));

  const result = await run(["status", "--json"], { projectId: "project-1" });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(helperCalls, [], "no card context means no helper call");
  assert.deepEqual(JSON.parse(result.stdout), BOARD);
});
