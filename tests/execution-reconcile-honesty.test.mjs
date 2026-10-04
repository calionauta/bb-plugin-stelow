/**
 * A run that was only DISPATCHED must not read as finished.
 *
 * Found on card_1fgz8lge (thread thr_j4j2wtak9i), where two native runs sat in
 * the ledger as `normalized_status = succeeded` while `native_status` was still
 * `running`, with `completed_at` set — a run reported as done while it was
 * executing, and the card showing it answered before it had run. Across the live
 * database not one run carried a terminal native status: 31 at succeeded/running,
 * 8 at failed/running, 5 at failed/queued, 2 at requested/failed.
 *
 * The cause was that "succeeded" had two meanings ten lines apart in one
 * function. At launch the host's `succeeded` means the dispatch was ACCEPTED, so
 * the run is running; the same value was then written as `succeeded`, which means
 * finished. Terminal states accept no further transitions
 * (`TRANSITIONS.succeeded` is empty) and the reconciler answers a terminal run
 * without a host round trip, so a run marked finished at launch could never be
 * corrected: the adapter was never asked what was happening, and the native
 * column kept whatever it held mid-flight.
 *
 * Two things are pinned here, and they are different kinds of claim. The
 * behaviour: given a run holding a host handle, the host is asked, and the row
 * follows its answer. The wiring: the launch path writes no terminal state at
 * all, which is the part that cannot be reached through this harness because
 * recordRunIdentity is private.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createExecutionRun,
  getExecutionRun,
  transitionExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { executionRunDb } from "./helpers/execution-run-harness.mjs";
import { reconcileOne } from "../server/execution-reconcile-run.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function newDb() {
  return executionRunDb("card-1");
}

const CARD = {
  id: "card-1",
  worker_thread_id: "thread-1",
  project_id: "project-1",
  status: "in-progress",
  stage: "audit",
};

const RUN_INPUT = {
  cardId: "card-1",
  projectId: "project-1",
  recipeId: "execution-audit",
  stage: "audit",
  sourceHash: "sha256:abc",
  sourceText: "return { state: 'succeeded' };",
  argsText: "{}",
  adapter: "bb-workflows",
  workspaceId: "workspace-1",
  artifactRoot: "workspace-1/.stelow/run",
  originThreadId: "thread-1",
};

function harness() {
  const db = newDb();
  const asked = [];
  const host = { state: "running" };
  const deps = {
    db,
    now: () => 1_000,
    getCard: () => CARD,
    logComment: () => {},
    publishCard: () => {},
    native: {
      adapterFor: () => ({
        status: async () => {
          asked.push(host.state);
          return { state: host.state };
        },
      }),
    },
    dispatch: { reconcileBoundary: async () => {}, reconcileArtifacts: async () => {} },
  };
  return {
    db,
    asked,
    deps,
    setHostState: (value) => { host.state = value; },
    dispatched: (id = "local-1") => dispatchedRun(db, id),
  };
}

// The row the fixed launch leaves behind: created `queued`, then dispatched —
// which the host accepting means `running` — holding a native handle and no
// completed_at. Both transitions are the ones the launch performs.
function dispatchedRun(db, id = "local-1") {
  const run = createExecutionRun(db, { ...RUN_INPUT, id, runId: `native-${id}`, now: 100 });
  return transitionExecutionRun(db, run.id, "running", { nativeStatus: "running", now: 100 });
}

// 1. The host is asked. A run holding a handle cannot be answered from the row.
{
  const h = harness();
  h.dispatched();
  await reconcileOne(h.deps, "local-1");
  assert.ok(h.asked.length > 0, "a run with a native handle must consult the host");
}

// 2. A run the host still reports as running does not present as finished. The
//    state the live database is full of: succeeded with a running native column.
{
  const h = harness();
  h.dispatched();
  h.setHostState("running");
  await reconcileOne(h.deps, "local-1");
  assert.equal(
    getExecutionRun(h.db, "local-1").normalizedStatus,
    "running",
    "a run the host still reports as running cannot be recorded as finished",
  );
}

// 3. When the host does finish, the row says so — in the native column too, so
//    the two never disagree the way 31 live rows do.
{
  const h = harness();
  h.dispatched();
  h.setHostState("succeeded");
  await reconcileOne(h.deps, "local-1");
  const row = getExecutionRun(h.db, "local-1");
  assert.equal(row.normalizedStatus, "succeeded", "a finished run is recorded finished");
  assert.equal(row.nativeStatus, "succeeded", "the native column reaches the same terminal value");
  assert.ok(row.completedAt, "finishing is what stamps completed_at, not dispatching");
}

// 4. The launch path writes no terminal state. recordRunIdentity is private, so
//    this is the wiring pin: a second transition to a terminal status inside it
//    is exactly the defect, and it would put every run past correction again.
const launch = readFileSync(join(root, "server/execution-native-launch.ts"), "utf8");
const identity = launch.slice(launch.indexOf("function recordRunIdentity"));
assert.doesNotMatch(
  identity,
  /transitionExecutionRun\([^)]*,\s*"succeeded"/,
  "the launch path must not write a terminal state — the host alone decides a run finished",
);
assert.match(
  identity,
  /native\.state === "succeeded" \? "running"/,
  "a dispatch the host accepted is a running run",
);

console.log("run reconcile test ok: a dispatched run is asked about, and its row follows the host");
