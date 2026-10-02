import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { beginRespawn, endRespawn, respawnInFlight } from "../server/workers-respawn-guard.ts";

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
 */
const respawnSource = readFileSync(new URL("../server/workers-respawn.ts", import.meta.url), "utf8");
assert.match(
  respawnSource,
  /const refusal = beginRespawn\(cardId, reason\);\s*\n\s*if \(refusal\) return \{ ok: false, error: refusal \};/,
  "respawn refuses a concurrent caller before it touches the host",
);
assert.match(respawnSource, /finally \{\s*\n\s*endRespawn\(cardId\);/, "the guard is released even when the spawn throws");

// And the deferred band swap must not stack a second armed timer on the same
// card: it overwrote the handle without cancelling the one it replaced, so the
// orphan timer fired 10ms later and spawned a THIRD thread.
const schedulerSource = readFileSync(new URL("../server/workers-scheduler.ts", import.meta.url), "utf8");
assert.match(
  schedulerSource,
  /const pending = timers\.get\(cardId\);\s*\n\s*if \(pending !== undefined\) scheduler\.clearTimeout\(pending\);/,
  "a pending band swap is cancelled before its replacement is armed",
);
