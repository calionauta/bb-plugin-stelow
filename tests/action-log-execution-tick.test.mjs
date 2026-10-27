/**
 * The reconcile tick names the step that took the time, and stops where it broke.
 *
 * The tick used to record one duration for the whole pass, so a reconciler that
 * burned its 45s window inside a single step looked exactly like one that spent
 * it evenly, and a pass that died in `reconcileStageEntries` recorded the same
 * error row as one that died right after `reconcileRuns`. `runReconcilePass`
 * splits the pass into named steps so the row can say both: every attempted
 * step contributes its own milliseconds, and the first failure names itself
 * instead of collapsing into "the reconcile failed".
 *
 * What is pinned here is that topology, not a string:
 *
 *   - the three steps run one at a time, in the documented order — runs, stage
 *     entries, then the forge check — because the publication check exists to
 *     corroborate work the first two just settled, and a pass that overlapped
 *     them would ask the forge about a ledger that was still being repaired;
 *   - a failing step ends the pass. A publication check after a failed repair
 *     is work done on a record that was never fixed, and its own 0ms would
 *     make the phase map claim a step that never ran;
 *   - an absent `reconcilePublications` is a configuration, not a failure: the
 *     phase still appears, because the tick's shape must not depend on which
 *     caller wired which optional module;
 *   - a rejecting `reconcilePublications` is swallowed by the pass. A forge
 *     outage cannot fail a pass whose real work — repairing runs and stage
 *     entries — already succeeded.
 *
 * The clock advances 5ms per reading so every duration is deterministic. With
 * `Date.now()` these assertions would measure how fast the test host schedules
 * promises, and the "a phase was recorded" check would pass on 0ms noise.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { runReconcilePass } from "../server/execution-reconcile.ts";

/** Every reading is 5ms later than the last: `step` reads it twice per step. */
function tickingClock() {
  let current = 0;
  return () => {
    current += 5;
    return current;
  };
}

/**
 * One probe step, recorded on entry and on exit. The paired markers prove the
 * steps run in order AND that no two overlap: a parallel implementation would
 * emit both `start` markers before either `end` marker.
 */
function tracked(calls, name, run = () => undefined) {
  return async () => {
    calls.push(`${name}: start`);
    try {
      return await run();
    } finally {
      calls.push(`${name}: end`);
    }
  };
}

const starts = (calls) => calls.filter((call) => call.endsWith(": start"));

test("a clean pass runs every step in order and records one phase per step", async () => {
  const calls = [];
  const deps = {
    now: tickingClock(),
    reconcilePublications: tracked(calls, "publications"),
  };
  const sweep = {
    reconcileRuns: tracked(calls, "runs"),
    reconcileStageEntries: tracked(calls, "stage entries"),
  };

  const pass = await runReconcilePass(deps, sweep);

  assert.equal(pass.failed, null, "a pass whose steps all resolve reports no failure");
  assert.deepEqual(
    calls,
    [
      "runs: start",
      "runs: end",
      "stage entries: start",
      "stage entries: end",
      "publications: start",
      "publications: end",
    ],
    "the steps run one at a time, in the order that lets the forge check see a repaired ledger",
  );
  assert.deepEqual(
    Object.keys(pass.phases),
    ["runs", "stage entries", "publications"],
    "each attempted step owns a phase, in the order it ran",
  );
  for (const [name, elapsed] of Object.entries(pass.phases)) {
    assert.equal(typeof elapsed, "number", `phase "${name}" is a millisecond count, never a label`);
    assert.ok(elapsed >= 5, `phase "${name}" includes the step it times; a 5ms clock cannot yield ${elapsed}`);
  }
});

test("a failing step names itself, stops the pass, and keeps the thrown error", async () => {
  const calls = [];
  const boom = new Error("stage entry repair failed");
  const deps = {
    now: tickingClock(),
    reconcilePublications: tracked(calls, "publications"),
  };
  const sweep = {
    reconcileRuns: tracked(calls, "runs"),
    reconcileStageEntries: tracked(calls, "stage entries", async () => {
      throw boom;
    }),
  };

  const pass = await runReconcilePass(deps, sweep);

  assert.ok(pass.failed, "a step that throws fails the pass");
  assert.equal(pass.failed.name, "stage entries", "the failure names the step that raised, not the pass");
  assert.equal(
    pass.failed.error,
    boom,
    "the thrown object itself survives: `isDatabaseClosedError` decides the recovery from it, and a re-wrapped message would answer wrong",
  );
  assert.deepEqual(starts(calls), ["runs: start", "stage entries: start"], "no step is entered after a failure");
  assert.deepEqual(
    Object.keys(pass.phases),
    ["runs", "stage entries"],
    "a skipped step records no phase at all — a 0ms entry would claim work the pass never attempted",
  );
});

test("an absent reconcilePublications leaves a publications phase and no failure", async () => {
  const calls = [];
  const sweep = {
    reconcileRuns: tracked(calls, "runs"),
    reconcileStageEntries: tracked(calls, "stage entries"),
  };

  const pass = await runReconcilePass({ now: tickingClock() }, sweep);

  assert.equal(pass.failed, null, "an unwired optional step is a configuration, never a failed pass");
  assert.deepEqual(
    starts(calls),
    ["runs: start", "stage entries: start"],
    "the pass still runs its real work when the optional module is missing",
  );
  assert.equal("publications" in pass.phases, true, "the phase is recorded whether or not the module exists");
  assert.ok(
    pass.phases.publications >= 0,
    `the optional step still reports elapsed time, got ${pass.phases.publications}`,
  );
});

test("a rejecting reconcilePublications cannot fail the pass", async () => {
  const calls = [];
  let attempts = 0;
  const offline = new Error("forge unreachable");
  const deps = {
    now: tickingClock(),
    reconcilePublications: tracked(calls, "publications", async () => {
      attempts += 1;
      throw offline;
    }),
  };
  const sweep = {
    reconcileRuns: tracked(calls, "runs"),
    reconcileStageEntries: tracked(calls, "stage entries"),
  };

  const pass = await runReconcilePass(deps, sweep);

  assert.equal(attempts, 1, "the rejected check must actually have run, or the swallow below proves nothing");
  assert.equal(pass.failed, null, "a forge outage cannot fail the pass whose repair work already succeeded");
  assert.deepEqual(
    Object.keys(pass.phases),
    ["runs", "stage entries", "publications"],
    "a swallowed rejection is still a phase: the step ran, it just could not conclude",
  );
  assert.ok(
    pass.phases.publications >= 5,
    `the failed step's time is recorded, got ${pass.phases.publications}`,
  );
});
