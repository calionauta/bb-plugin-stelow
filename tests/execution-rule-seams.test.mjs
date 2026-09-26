// Executable tests for the rules the four execution factories were split into.
// Each rule is a module-level function over a dependency slice, so each one is
// driven here with a recording double and a real in-memory ledger — no
// composition root, no host. The negative controls are the point: every case
// below names the behaviour it would stop if the rule were inlined back, so a
// reverted split cannot pass this file green.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { reconcileBoundary } from "../server/execution-reconcile-boundary.ts";
import { reconcileArtifacts } from "../server/execution-reconcile-artifacts.ts";
import { reconcileOne } from "../server/execution-reconcile-run.ts";
import { createExecutionRun, ensureExecutionRunTable, getExecutionRun, transitionExecutionRun } from "../lib/execution-run-ledger.mjs";
import { canonicalStage, requiredCapabilities } from "../server/execution-native-catalog.ts";
import { stopOwned } from "../server/execution-lifecycle-stop.ts";
import { routeAnswerContinuation } from "../server/execution-lifecycle-resume.ts";
import { recipeById } from "../lib/recipe-catalog.mjs";
import { STAGE_BY_ID } from "../lib/workflow-vocabulary.mjs";

// A ledger with a card, so ownership and foreign keys behave as in production.
function ledger(cardId = "card-1") {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO cards (id) VALUES (?)").run(cardId);
  ensureExecutionRunTable(db);
  return db;
}

const RUN = {
  id: "local-1",
  cardId: "card-1",
  projectId: "project-1",
  recipeId: "plan-critique",
  stage: "critique",
  sourceHash: "sha256:abc",
  sourceText: "return { state: 'succeeded' };",
  argsText: JSON.stringify({ context: {}, localRunId: "local-1", recipeId: "plan-critique" }),
  adapter: "bb-workflows",
  workspaceId: "workspace-1",
  artifactRoot: "workspace-1/.stelow/run",
  originThreadId: "thread-1",
};

const CARD = { id: "card-1", worker_thread_id: "thread-1", stage: "critique" };

// --- boundary rule ---------------------------------------------------------
// A run that reports it needs input owns exactly one card question, and the run
// is only marked as having sent it once that question is really there. The
// boundary it opens has to be answerable: the contract fields below are what
// `lib/interface-contrast` validates, and a payload without them is refused.
const BOUNDARY = {
  question: "Approve the critique?",
  questionId: null,
  contractId: "critique-confirm-1",
  kind: "confirmation",
  shapeVersion: "v1",
  scopeMapVersion: null,
};
{
  const db = ledger();
  createExecutionRun(db, { ...RUN, runId: "run-1", now: 100 });
  const asked = [];
  const deps = {
    db,
    randomId: () => "boundary-1",
    logComment: (cardId, targetId, body) => asked.push([cardId, targetId, body]),
    notify: { sendToCard: (card, text) => asked.push(["thread", card.id, text]) },
    fetchPendingQuestions: async () => [],
  };
  await reconcileBoundary(deps, getExecutionRun(db, "local-1"), CARD, BOUNDARY);
  const run = getExecutionRun(db, "local-1");
  assert.equal(run.normalizedStatus, "needs_input");
  assert.equal(run.boundaryId, "boundary-1");
  assert.equal(run.boundaryContract.contractId, "critique-confirm-1", "the answered contract travels with the run");
  assert.equal(run.needsInputSentAt, null, "no question exists yet, so the sent marker stays unset");
  assert.match(asked.at(-1)[2], /\[Stelow boundary boundary-1\]/);

  // Negative control: the pending question carrying the marker is what flips
  // needsInputSentAt. Without it, the claim that the question was sent is a
  // guess — and a run would then never be re-asked.
  await reconcileBoundary(deps, run, CARD, BOUNDARY);
  assert.match(asked.at(-1)[2], /Create the pending card question/);
  await reconcileBoundary({ ...deps, fetchPendingQuestions: async () => [{ question: "x [Stelow boundary boundary-1]" }] },
    getExecutionRun(db, "local-1"), CARD, BOUNDARY);
  assert.notEqual(getExecutionRun(db, "local-1").needsInputSentAt, null);
}

// A boundary nobody can answer fails the run instead of parking it: the card
// would wait on a question with no contract, and nothing could ever close it.
{
  const db = ledger();
  createExecutionRun(db, { ...RUN, runId: "run-1", now: 100 });
  const asked = [];
  const deps = {
    db,
    randomId: () => "boundary-1",
    logComment: (cardId, targetId, body) => asked.push([cardId, targetId, body]),
    notify: { sendToCard: (card, text) => asked.push(["thread", card.id, text]) },
    fetchPendingQuestions: async () => [],
  };
  await reconcileBoundary(deps, getExecutionRun(db, "local-1"), CARD, {
    question: "Approve the critique?",
    questionId: null,
  });
  const run = getExecutionRun(db, "local-1");
  assert.equal(run.normalizedStatus, "failed");
  assert.equal(run.errorCode, "invalid-native-boundary");
  assert.match(asked.at(-1)[2], /invalid human boundary/, "the card is told which boundary was refused");
  assert.equal(
    asked.filter(([first]) => first === "thread").length,
    0,
    "no question is opened for a dead contract — nothing can ever answer it",
  );
}

// --- artifact rule ---------------------------------------------------------
// Success is not completion. The run only succeeds when the receipt names this
// run and every required output; anything else stalls with a named reason.
{
  const db = ledger();
  createExecutionRun(db, { ...RUN, runId: "run-1", now: 100 });
  const recipe = recipeById("plan-critique");
  const paths = recipe.tasks.map((task) => task.output);
  const files = new Map();
  const deps = {
    db,
    bb: { sdk: { files: { read: async ({ path }) => {
      if (!files.has(path)) throw new Error("no file");
      return { content: files.get(path) };
    } } } },
    logComment: (cardId, targetId, body) => files.set("comment", body),
    notify: { sendToCard: () => {} },
  };
  const run = getExecutionRun(db, "local-1");

  // Missing artifact: failed with the missing code, and a comment that names it.
  await reconcileArtifacts(deps, CARD, run);
  assert.equal(getExecutionRun(db, "local-1").normalizedStatus, "failed");
  assert.match(files.get("comment"), /Missing: critiques\//);

  // All artifacts present but no receipt: the run stays where it was and asks
  // for the registration receipt exactly once.
  const fresh = ledger();
  createExecutionRun(fresh, { ...RUN, runId: "run-1", now: 100 });
  transitionExecutionRun(fresh, "local-1", "running", { nativeStatus: "running" });
  for (const path of paths) {
    files.set(`workspace-1/.stelow/run/${path}`, path.endsWith(".json")
      ? JSON.stringify({ findings: [], questions: [], verdict: "pass" })
      : "report");
  }
  const asked = [];
  const staged = { ...deps, db: fresh, logComment: () => {}, notify: { sendToCard: (c, t) => asked.push(t) } };
  await reconcileArtifacts(staged, CARD, getExecutionRun(fresh, "local-1"));
  assert.equal(getExecutionRun(fresh, "local-1").normalizedStatus, "running", "an unregistered run is not finished");
  assert.equal(asked.length, 1);
  assert.match(asked[0], /\.registered\.json/);
  // Negative control: the completion event already exists, so the receipt is
  // not requested a second time — one request per run, not one per reconcile.
  await reconcileArtifacts(staged, CARD, getExecutionRun(fresh, "local-1"));
  assert.equal(asked.length, 1);

  // A receipt naming another run is not this run's receipt.
  files.set("workspace-1/.stelow/run/.registered.json", JSON.stringify({ runId: "other", outputs: paths }));
  await reconcileArtifacts(staged, CARD, getExecutionRun(fresh, "local-1"));
  assert.notEqual(getExecutionRun(fresh, "local-1").normalizedStatus, "succeeded");
  files.set("workspace-1/.stelow/run/.registered.json", JSON.stringify({ runId: "local-1", outputs: paths }));
  await reconcileArtifacts(staged, CARD, getExecutionRun(fresh, "local-1"));
  assert.equal(getExecutionRun(fresh, "local-1").normalizedStatus, "succeeded");
}

// --- one-run rule ----------------------------------------------------------
// A boundary wins over a reported success, and an unchanged row is not
// republished: the card is only woken when the row really moved.
{
  const db = ledger();
  createExecutionRun(db, { ...RUN, runId: "run-1", now: 100 });
  const published = [];
  const dispatched = [];
  const deps = {
    db,
    now: () => 100,
    getCard: () => CARD,
    logComment: () => {},
    publishCard: (cardId) => published.push(cardId),
    native: { adapterFor: () => ({ status: async () => ({ state: "needs_input" }) }) },
    dispatch: {
      reconcileBoundary: async (run, card, boundary) =>
        dispatched.push(["boundary", boundary.question]),
      reconcileArtifacts: async () => dispatched.push(["artifacts"]),
    },
  };
  const result = await reconcileOne(deps, "local-1");
  assert.deepEqual(
    dispatched,
    [["boundary", "The plan-critique workflow needs a human decision before it can continue."]],
    "a native needs_input with no question of its own still gets a boundary",
  );
  assert.equal(result.error, null, "a run that reconciled cleanly reports no error");
  assert.deepEqual(published, [], "a run whose row did not move is not republished");

  // Negative control: a success with a boundary question is a question, not a
  // completion. Drop the boundary branch and the artifacts rule would fire.
  dispatched.length = 0;
  deps.native.adapterFor = () => ({ status: async () => ({ state: "succeeded", result: { question: "Approve?" } }) });
  await reconcileOne(deps, "local-1");
  assert.deepEqual(dispatched, [["boundary", "Approve?"]]);

  // A missing run is an error, not a silent no-op: the caller asked about a row
  // that is not there and must be told.
  assert.deepEqual(await reconcileOne(deps, "nope"), { run: null, error: "Execution run not found." });

  // The republish tell: with a dispatch that really moves the row, the card is
  // woken once; reconciling the same run again changes nothing and wakes it
  // not at all. Without the runKey compare, every pass republishes.
  const moving = ledger();
  createExecutionRun(moving, { ...RUN, id: "local-9", runId: "run-9", now: 100 });
  const woke = [];
  const real = {
    ...deps,
    db: moving,
    publishCard: (cardId) => woke.push(cardId),
    native: { adapterFor: () => ({ status: async () => ({ state: "succeeded" }) }) },
    dispatch: {
      reconcileBoundary: async () => {},
      reconcileArtifacts: (card, run) => transitionExecutionRun(moving, run.id, "running", { nativeStatus: "running" }),
    },
  };
  await reconcileOne(real, "local-9");
  assert.deepEqual(woke, ["card-1"], "a row that moved republishes its card");
  await reconcileOne({ ...real, native: { adapterFor: () => ({ status: async () => ({ state: "running" }) }) } }, "local-9");
  assert.deepEqual(woke, ["card-1"], "a row that did not move republishes nothing");

  // A run the host never started ages out instead of waiting forever. A queued
  // row with no runId is the one state no host round trip can resolve, so the
  // clock is the only exit it has — and it must fail the run, not leave a card
  // waiting on a worker that was never launched.
  const stalled = ledger();
  createExecutionRun(stalled, { ...RUN, id: "local-8", runId: null, now: 0 });
  const stalledDeps = { ...deps, db: stalled, now: () => 120_000, publishCard: () => {} };
  const aged = await reconcileOne(stalledDeps, "local-8");
  assert.equal(aged.run.normalizedStatus, "failed");
  assert.equal(aged.run.errorCode, "native-start-timeout");
  assert.deepEqual(dispatched, [["boundary", "Approve?"]], "an unstarted run never reaches the host at all");

  const inside = ledger();
  createExecutionRun(inside, { ...RUN, id: "local-7", runId: null, now: 0 });
  const waiting = await reconcileOne({ ...stalledDeps, db: inside, now: () => 1_000 }, "local-7");
  assert.equal(waiting.run.normalizedStatus, "queued", "inside the grace window the run waits");
}

// --- stop rule -------------------------------------------------------------
// A stop that cannot reach the host must say so, or a card keeps a live run
// nobody believes is dead.
{
  const db = ledger();
  createExecutionRun(db, { ...RUN, runId: "run-1", now: 100 });
  const cancel = (impl) => ({
    db,
    logComment: () => {},
    publishCard: () => {},
    native: { adapterFor: () => ({ cancel: impl }) },
  });
  assert.equal(await stopOwned(cancel(async () => ({})), "card-1", "card-archived"), true);
  assert.equal(getExecutionRun(db, "local-1").normalizedStatus, "cancelled");

  const second = ledger();
  createExecutionRun(second, { ...RUN, runId: "run-2", now: 100 });
  const refused = await stopOwned({
    db: second,
    logComment: () => {},
    publishCard: () => {},
    native: { adapterFor: () => ({ cancel: async () => { throw new Error("host unreachable"); } }) },
  }, "card-1", "card-archived");
  assert.equal(refused, false, "a host that refused the cancel is reported, not swallowed");
  assert.equal(getExecutionRun(second, "local-1").normalizedStatus, "queued", "the row stays live while the host does");
}

// --- answer routing --------------------------------------------------------
// Only a question carrying the run's own boundary marker resumes anything.
{
  const db = ledger();
  createExecutionRun(db, { ...RUN, runId: "run-1", now: 100 });
  transitionExecutionRun(db, "local-1", "needs_input", { boundaryId: "b-1", boundaryQuestion: "Approve?" });
  const sent = [];
  const deps = {
    db,
    bb: { sdk: { threads: { send: async (input) => sent.push(input) } } },
    listRuns: () => [getExecutionRun(db, "local-1")],
  };
  const answered = await routeAnswerContinuation(deps, "card-1", "thread-1", [{ question: "looks good", answers: ["yes"] }]);
  assert.equal(answered, null, "an unrelated answer never resumes a run");
  assert.equal(sent.length, 1, "an unrelated answer is a continuation for the worker");
  const boundary = await routeAnswerContinuation(deps, "card-1", "thread-1", [{ question: "[Stelow boundary b-1]", answers: ["yes"] }]);
  assert.ok(boundary, "the run whose marker the answer carries is the one to resume");
}

// --- the vocabulary the native rules share ---------------------------------
// One definition of "the capabilities this stage needs", deduplicated, so a
// capability named by the stage and the recipe is checked and reported once.
{
  const stage = STAGE_BY_ID.critique;
  const recipe = recipeById("plan-critique");
  const needed = requiredCapabilities(stage, recipe);
  assert.deepEqual(needed, [...new Set(needed)], "capabilities are deduplicated");
  assert.deepEqual(requiredCapabilities(stage, recipe), needed, "the answer does not depend on call order");
  assert.equal(canonicalStage(undefined, "plan-critique").id, stage.id, "a recipe with no stage named still resolves");
  assert.equal(canonicalStage("critique", "plan-critique").id, stage.id);
  assert.equal(canonicalStage("nonexistent", "plan-critique"), undefined, "an unknown stage resolves to nothing, not a guess");
}

console.log(
  "execution rule seams ok: boundary, artifacts, one-run, start timeout, stop, answer routing, shared vocabulary",
);
