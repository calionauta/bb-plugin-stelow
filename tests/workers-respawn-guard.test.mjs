import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  beginRespawn,
  claimRespawnRow,
  endRespawn,
  respawnInFlight,
} from "../server/workers-respawn-guard.ts";
import { createRespawnScheduler } from "../server/workers-scheduler.ts";
import { respawn } from "../server/workers-respawn.ts";

/**
 * One card, one coordinator thread.
 *
 * A card owns one `worker_thread_id`, and replacing the worker spawns the new
 * thread BEFORE stopping the old one — the right order, since a failed spawn
 * must not leave a card with no worker. It also means two threads are briefly
 * live for every respawn, which is only safe if two respawns cannot overlap.
 *
 * They could. A band swap on a stage advance, an automatic spawn retry, and a
 * manual Restart Worker are three independent callers of `respawn`, none locked
 * against the others, and each spawns a thread. Overlapping, the first
 * replacement is orphaned: not the card's `worker_thread_id`, so nothing that
 * stops a card's worker can reach it, and not in `card_threads` under any other
 * id either.
 *
 * (For the record: this is the race the earlier report inferred from the two
 * `stelow-interface-contrast` threads a user saw. Those were host fan-out
 * children — `originPluginId: workflows`, `lifecycleOwnerThreadId` pointing at
 * the coordinator, one per recipe task, both archived when the run ended. No
 * orphan happened. The race is still real, so the guard is still worth having;
 * it just was not that.)
 */

// The guard's state is module-level on purpose — it has to outlive any one
// call — so each test claims its OWN card. Sharing one id across tests would
// make them order-dependent, and an order-dependent guard test passes for the
// wrong reason exactly when the guard is most likely to be wrong.
test("a second respawn for the same card is refused, not queued", () => {
  const first = beginRespawn("card-refused", "band-swap");
  assert.equal(first, null, "the first caller is the one that gets to spawn");
  assert.equal(respawnInFlight("card-refused"), true);

  const second = beginRespawn("card-refused", "restart");
  assert.match(second, /already replacing its worker thread \(restart\)/);
  assert.match(second, /try again once it settles/i, "a refusal with no door is a deadlock");
  endRespawn("card-refused");
});

test("different cards never block each other", () => {
  assert.equal(beginRespawn("card-parallel-a", "band-swap"), null);
  assert.equal(beginRespawn("card-parallel-b", "band-swap"), null, "the guard is per card, not global");
  endRespawn("card-parallel-a");
  endRespawn("card-parallel-b");
});

test("a card is available again once its respawn settles", () => {
  assert.equal(beginRespawn("card-settles", "restart"), null);
  endRespawn("card-settles");
  assert.equal(respawnInFlight("card-settles"), false);
  assert.equal(beginRespawn("card-settles", "restart"), null, "the next caller is not permanently locked out");
  endRespawn("card-settles");
});

test("ending a respawn for a card that never started is harmless", () => {
  endRespawn("card-never-started");
  assert.equal(respawnInFlight("card-never-started"), false);
});

/**
 * The guard is only load-bearing if the actual respawn path takes it. A guard
 * module that everything imports and nothing calls is the exact shape of bug
 * this change exists to remove — `keepsCardRunning` was exported, documented,
 * and called by nothing for months.
 *
 * The pins that used to assert this by reading `workers-respawn.ts` and
 * `workers-scheduler.ts` as text are replaced by driving the real modules: a
 * source-text match passes on a respawn that never calls the guard, and the
 * behavioral case below fails on it.
 */

/** The deps `respawn` reads, with a host whose spawn can be made to throw. */
function respawnDeps({ spawn } = {}) {
  return {
    db: new Database(":memory:"),
    bb: {
      sdk: {
        threads: {
          spawn: spawn ?? (async () => ({ id: "thread-new" })),
          archive: async () => {},
          stop: async () => {},
        },
      },
    },
    now: () => 100,
    getCard: () => ({ ...RESPAWN_CARD }),
    updateCard: () => {},
    getPreset: () => RESPAWN_PRESET,
    presetParams: () => ({ ...RESPAWN_PARAMS }),
    prepareRespawn: async () => ({
      prompt: "Continue the card",
      projectPath: "/repo",
      workspace: { path: "/repo", hostId: "host-a" },
    }),
    recordThread: () => {},
    lineage: async () => {},
    continuingEnvironment: async () => ({ type: "project-default" }),
    errors: { cardNotFound: "Card not found.", presetNotFound: "Preset not found." },
  };
}

const RESPAWN_CARD = {
  id: "card-1",
  project_id: "project-1",
  name: "Card One",
  display_name: "Card One",
  worker_thread_id: "thread-old",
  dir_hash: null,
  workspace_kind: "project",
};

const RESPAWN_PRESET = {
  id: "preset-1",
  provider_id: "pi",
  model_id: "model",
  reasoning_level: "medium",
  permission_mode: "full",
  environment_kind: "project-default",
  base_branch: null,
  machine_id: null,
  instructions: "",
};

const RESPAWN_PARAMS = {
  providerId: "pi",
  modelId: "model",
  reasoningLevel: "medium",
  permissionMode: "full",
  environmentKind: "project-default",
  machineId: null,
  instructions: "",
};

test("respawn refuses a concurrent caller before it touches the host", async () => {
  const deps = respawnDeps();
  const spawned = [];
  deps.bb.sdk.threads.spawn = async () => {
    spawned.push("spawn");
    return { id: "thread-new" };
  };
  // Hold the guard exactly as an in-flight respawn would.
  assert.equal(beginRespawn("card-refuse-host", "band-swap"), null);
  try {
    const outcome = await respawn(deps, "card-refuse-host", "preset-1", "restart");
    assert.equal(outcome.ok, false, "the second caller is refused, not queued");
    assert.match(
      outcome.error,
      /already replacing its worker thread \(restart\)/,
      "the refusal names the reason and the card",
    );
    assert.deepEqual(spawned, [], "the refused caller never reaches the host to spawn a thread");
  } finally {
    endRespawn("card-refuse-host");
    deps.db.close();
  }
});

test("both guards release when the spawn throws, so a retry is not locked out", async () => {
  const deps = respawnDeps({
    spawn: async () => {
      throw new Error("host down");
    },
  });
  const cardId = "card-finally";
  const first = await respawn(deps, cardId, "preset-1", "restart");
  assert.equal(first.ok, false, "a throwing spawn returns a failed outcome, never rejects");
  assert.equal(respawnInFlight(cardId), false, "the memory guard is released in finally");
  assert.equal(
    claimRespawnRow(deps.db, cardId, "restart", 200),
    true,
    "the durable claim row is released too: a second claim on the same card succeeds",
  );
  // The replacement claim is a fact about release, not a claim we keep alive.
  deps.db.prepare("DELETE FROM respawn_inflight WHERE card_id = ?").run(cardId);
  deps.db.close();
});

test("a deferred respawn cancels the timer it replaces, so one card never arms two", () => {
  const armed = [];
  const cleared = [];
  const fired = [];
  const scheduler = {
    setTimeout: (callback) => {
      const handle = { callback };
      armed.push(handle);
      return handle;
    },
    clearTimeout: (handle) => cleared.push(handle),
  };
  const schedule = createRespawnScheduler(scheduler, (cardId) => fired.push(cardId));

  schedule.schedule("card-arm", "preset-1");
  const first = armed[0];
  schedule.schedule("card-arm", "preset-1");

  assert.deepEqual(cleared, [first], "the pending timer is cancelled before its replacement is armed");
  assert.equal(armed.length, 2, "the second schedule arms its own timer");

  // Only the surviving timer fires, exactly once — the orphan timer is gone.
  armed[1].callback();
  assert.deepEqual(fired, ["card-arm"], "only the newest swap fires, so the card gains one worker");
  schedule.dispose();
});
