import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { workerTestDb } from "./helpers/worker-test-db.mjs";
import { createWorkers } from "../server/workers.ts";
import {
  beginRespawn,
  claimRespawnRow,
  endRespawn,
  recoverInterruptedRespawns,
} from "../server/workers-respawn-guard.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverFile = (name) => readFileSync(join(root, "server", name), "utf8");

function serverSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) out.push([path, readFileSync(path, "utf8")]);
    }
  };
  walk(join(root, "server"));
  return out;
}

const preset = {
  id: "preset-a",
  name: "Primary",
  providerId: "pi",
  modelId: "bifrost/harness-coding",
  reasoningLevel: "medium",
  permissionMode: "full",
  environmentKind: "project-default",
  machineId: null,
  baseBranch: null,
};

function card(overrides = {}) {
  return {
    id: "card-1",
    project_id: "project-1",
    name: "card-one",
    display_name: "Card One",
    prompt: "Do the work",
    intent: "feature",
    status: "in-progress",
    stage: "triage",
    activity: "running",
    worker_thread_id: "thread-old",
    worker_preset_id: preset.id,
    preset_restart_pending: 0,
    dir_hash: "hash-1",
    auto_continue_count: 0,
    auto_continue_stage: null,
    spawn_retry_count: 0,
    spawn_retry_thread: null,
    attachments: "[]",
    workspace_kind: "project",
    workspace_path: null,
    workspace_host_id: null,
    kind: "build",
    research_strategy: null,
    research_strategies: null,
    explore_stage: null,
    last_error: null,
    last_assistant_text: null,
    last_idle_at: null,
    environment_label: "Project source",
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

// The SDK stub every respawn test drives the seam through: each call lands in
// `calls` so a case can assert order, and spawn ids count up so the slot-race
// case can name the orphan it must stop.
function stubBb(calls, { sendError = null, onSpawn } = {}) {
  return {
    sdk: {
      threads: {
        spawn: async (args) => {
          calls.push(["spawn", args]);
          return { id: onSpawn() };
        },
        archive: async (args) => calls.push(["archive", args]),
        stop: async (args) => calls.push(["stop", args]),
        get: async () => ({ environmentId: "env-ready" }),
        list: async () => [],
        events: { list: async () => [] },
        send: async (args) => {
          calls.push(["send", args]);
          if (sendError) throw new Error(sendError);
          return { delivery: "sent" };
        },
      },
      environments: {
        get: async () => ({ id: "env-ready", status: "ready", path: "/repo" }),
      },
      files: { write: async () => ({}) },
    },
    realtime: { publish: (event, payload) => calls.push([event, payload]) },
  };
}

function harness({ workerThreadId = "thread-old", sendError = null } = {}) {
  const db = workerTestDb();
  db.prepare("UPDATE cards SET worker_thread_id = ? WHERE id = ?").run(workerThreadId, "card-1");
  const calls = [];
  let spawnCount = 0;
  const current = card({ worker_thread_id: workerThreadId });
  const bb = stubBb(calls, { sendError, onSpawn: () => `thread-new-${++spawnCount}` });
  const workers = createWorkers({
    db,
    bb,
    now: () => 100,
    getCard: () => current,
    updateCard: (cardId, fields) => calls.push(["updateCard", cardId, fields]),
    comment: (cardId, body) => calls.push(["comment", cardId, body]),
    getPreset: () => preset,
    getReliablePreset: () => preset,
    presetParams: (value) => value,
    prepareRespawn: async () => ({
      prompt: "Continue the card",
      projectPath: "/repo",
      workspace: { path: "/repo", hostId: "host-a" },
    }),
    resetAutoContinue: () => ({ count: 0, stage: null }),
    errors: {
      cardNotFound: "Card not found.",
      cardArchived: "This card is archived.",
      presetNotFound: "Preset not found.",
    },
  });
  return { db, bb, calls, workers, current, spawns: () => spawnCount };
}

// A kill -9 between claim and release leaves a pending row whose holder is
// gone. The boot sweep reaps it and leaves a receipt, so the card explains
// a possible doubled worker instead of refusing its next replacement
// against a dead claim.
test("a kill -9 interrupted respawn is recovered at boot with a receipt", () => {
  const db = workerTestDb();
  db.prepare("UPDATE cards SET worker_thread_id = ? WHERE id = ?").run("thread-old", "card-1");
  db.prepare("INSERT INTO respawn_inflight (card_id, reason, started_at) VALUES (?, ?, ?)")
    .run("card-1", "restart", 1);
  const comments = [];
  const recovered = recoverInterruptedRespawns(db, {
    nowMs: 100,
    getCard: () => card(),
    comment: (cardId, body) => comments.push([cardId, body]),
  });
  assert.deepEqual(recovered, ["card-1"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM respawn_inflight").get().n, 0, "the dead claim is gone");
  assert.ok(
    comments.some(([, body]) => body.includes("interrupted by a restart") && body.includes("restart")),
    "the card names the outage instead of deleting the row in silence",
  );
  db.close();
});

// The same crash recovered through the real front door: constructing the
// workers (what a reboot does) clears the stale claim and the next respawn
// proceeds instead of refusing against a holder that no longer exists.
test("a stale durable claim does not block the next respawn after a reboot", async () => {
  const h = harness();
  h.db.prepare("INSERT INTO respawn_inflight (card_id, reason, started_at) VALUES (?, ?, ?)")
    .run("card-1", "band-swap", 1);
  // Simulate the reboot: a fresh guard has no memory of the claim, so only
  // the durable row can refuse — and the sweep must have reaped it. Here the
  // row belongs to a *live* holder (this process just claimed it), so claim
  //-then-release inside respawn still arbitrates; the point is the stale
  // row from before the boot is gone before any new claim is attempted.
  const stale = h.db.prepare("SELECT card_id FROM respawn_inflight WHERE card_id = ?").get("card-1");
  assert.ok(stale, "the pre-reboot row is present before recovery");
  const recovered = recoverInterruptedRespawns(h.db, {
    nowMs: 100,
    getCard: () => h.current,
    comment: () => undefined,
  });
  assert.deepEqual(recovered, ["card-1"]);
  const result = await h.workers.respawn("card-1", preset.id, "restart");
  assert.deepEqual(result, { ok: true, threadId: "thread-new-1" });
  h.workers.dispose();
  h.db.close();
});

// Two overlapping respawns: the second is refused before it spawns, so the
// first replacement is never orphaned. This is the exact race the guard
// exists for — a band swap, a retry, and a manual restart all call respawn.
test("a second respawn while one is running is refused without spawning", async () => {
  const h = harness();
  assert.equal(beginRespawn("card-1", "band-swap"), null, "the first caller holds the guard");
  try {
    const before = h.spawns();
    const result = await h.workers.respawn("card-1", preset.id, "restart");
    assert.equal(result.ok, false);
    assert.match(result.error, /already replacing its worker thread/);
    assert.equal(h.spawns(), before, "the refused caller spawns nothing");
  } finally {
    endRespawn("card-1");
  }
  h.workers.dispose();
  h.db.close();
});

// A durable claim held by another holder refuses without spawning either:
// the memory guard alone cannot see across processes sharing one database.
test("a durable claim held elsewhere refuses without spawning", async () => {
  const h = harness();
  assert.equal(claimRespawnRow(h.db, "card-1", "restart", 100), true, "the other holder claims first");
  try {
    const before = h.spawns();
    const result = await h.workers.respawn("card-1", preset.id, "band-swap");
    assert.equal(result.ok, false);
    assert.match(result.error, /already replacing its worker thread/);
    assert.equal(h.spawns(), before, "no spawn against a held claim");
  } finally {
    h.db.prepare("DELETE FROM respawn_inflight WHERE card_id = ?").run("card-1");
  }
  h.workers.dispose();
  h.db.close();
});

// The loser of the slot race stops its own orphan: the winner already moved
// the pointer, so this replacement's thread is reachable by nothing —
// except the stop call below. The card keeps the winner.
test("a respawn that loses the worker slot stops its orphan and keeps the winner", async () => {
  const h = harness();
  // The winner moved the slot after this card snapshot was read.
  h.db.prepare("UPDATE cards SET worker_thread_id = ? WHERE id = ?").run("thr-winner", "card-1");
  const result = await h.workers.respawn("card-1", preset.id, "restart");
  assert.equal(result.ok, false);
  assert.match(result.error, /Another replacement claimed the worker slot/);
  const stops = h.calls.filter(([name]) => name === "stop");
  assert.ok(
    stops.some(([, args]) => args.threadId === "thread-new-1"),
    "the loser's own thread is stopped, not left orphaned",
  );
  assert.ok(
    !h.calls.some(([name, , fields]) => name === "updateCard" && fields && "worker_thread_id" in fields),
    "the loser never points the card at its orphan",
  );
  assert.equal(h.db.prepare("SELECT worker_thread_id AS t FROM cards WHERE id = ?").get("card-1").t, "thr-winner");
  h.workers.dispose();
  h.db.close();
});

// Structural pins: each names the regression it would catch, so a revert
// fails here first instead of shipping silently.

// workers-spawn.ts is the only file that touches the spawn SDK: a second
// spawn literal anywhere else is a second birth path with no claim, no slot
// arbitration, and no recovery. Catches a reintroduced direct spawn.
{
  const holders = serverSources()
    .filter(([, source]) => source.includes("sdk.threads.spawn("))
    .map(([path]) => path);
  assert.deepEqual(holders, [join(root, "server", "workers-spawn.ts")], "one spawn path: the worker seam");
}

// applyBand schedules every swap: an immediate respawn inside a stage
// advance races the advance's own handoff and orphans the loser. Catches a
// reintroduced direct respawn on the band path (the >6-sites regression).
{
  const dispatch = serverFile("execution-advance-dispatch.ts");
  assert.doesNotMatch(dispatch, /deps\.respawn\(/, "band swaps schedule; they never respawn inline");
  assert.match(dispatch, /scheduleRespawn\(card\.id, preset\.id\)/, "the swap still happens — via the scheduler");
}

// No second opinion on the failure path: the judge spent a model call to
// guess at unclassified errors and burned budget on phantoms. Catches a
// reintroduced judge retry in the worker failure path.
{
  const retry = serverFile("workers-retry.ts");
  assert.doesNotMatch(retry, /judgeTransientError|rescuedByJudge/, "no judge on the spawn-failure path");
}

// The reconciler observes: resolving routes or starting runs inside a
// periodic sweep raced every explicit start and double-spent the card's
// single execution slot. Catches a reintroduced auto-start in the sweep.
{
  const sweep = serverFile("execution-reconcile-sweep.ts");
  assert.doesNotMatch(sweep, /startNativeStageForCard/, "the sweep never starts a run");
  assert.doesNotMatch(sweep, /resolveStageExecutionRoute/, "the sweep never resolves a route");
  assert.match(sweep, /no run was started automatically/, "the gap is observed as a receipt instead");
}

// At most six respawn call sites: every respawn spawns a thread, so every
// site is a way to double a worker. The band path schedules instead of
// calling, which is what keeps this list from growing back. Catches a
// seventh caller added without retiring one.
{
  const sites = [];
  for (const [path, source] of serverSources()) {
    for (const [index, line] of source.split("\n").entries()) {
      if (/export async function respawn\(/.test(line)) continue;
      for (const match of line.matchAll(/(?<![A-Za-z])respawn\(/g)) {
        void match;
        sites.push(`${path.split("/").slice(-2).join("/")}:${index + 1}`);
      }
    }
  }
  assert.ok(sites.length <= 6, `at most six respawn call sites (got ${sites.length}: ${sites.join(", ")})`);
}

// No swallowed sends on the four worker-facing paths: each delivery failure
// becomes a receipt comment naming the miss. Catches a reintroduced silent
// catch on a worker send (other silent catches — best-effort stops, advisory
// naming, the optional publication hook — are not worker sends).
for (const file of [
  "execution-reconcile.ts",
  "execution-native-launch.ts",
  "execution-lifecycle-resume.ts",
  "workers-respawn.ts",
]) {
  const source = serverFile(file);
  assert.doesNotMatch(
    source,
    /threads\.send\(\{[\s\S]{0,1500}\.catch\(\(\) => undefined\)/,
    `${file}: no swallowed worker send`,
  );
}

console.log("workers respawn recovery test ok: kill-9 recovery, double-respawn refusal, slot loser stops orphan, structural pins");
