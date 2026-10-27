import assert from "node:assert/strict";
import test from "node:test";
import { createPluginUpdateChecker } from "../server/runtime/plugin-update.ts";

function makeBb(run) {
  return {
    pluginId: "stelow",
    sdk: {
      plugins: {
        checkUpdates: async () => {
          run.checks += 1;
          const held = run.heldCheck;
          run.heldCheck = null;
          if (held) return held.promise;
          if (run.failChecks) throw new Error("network unavailable");
          return [{ id: "stelow", outcome: "current", installed: "1.0.0", candidate: null }];
        },
      },
    },
    log: { warn: (message) => run.warnings.push(message) },
  };
}

function harness() {
  const run = {
    checks: 0,
    releases: 0,
    now: 1000,
    failChecks: false,
    heldCheck: null,
    heldRelease: null,
    warnings: [],
  };
  const checker = createPluginUpdateChecker({
    bb: makeBb(run),
    installedVersion: "1.0.0",
    now: () => run.now,
    fetchRelease: async () => {
      run.releases += 1;
      const held = run.heldRelease;
      run.heldRelease = null;
      if (held) return held.promise;
      return { tag: "v1.0.0", url: "https://example.test/v1.0.0" };
    },
  });
  return {
    checker,
    get checks() { return run.checks; },
    get releases() { return run.releases; },
    warnings: run.warnings,
    advance: (value) => { run.now = value; },
    failNextChecks: () => { run.failChecks = true; },
    /** Hands the next SDK check to the test, so it can be left in flight. */
    holdNextCheck: () => {
      run.heldCheck = Promise.withResolvers();
      return run.heldCheck;
    },
    /** Hands the next GitHub release lookup to the test, same purpose. */
    holdNextRelease: () => {
      run.heldRelease = Promise.withResolvers();
      return run.heldRelease;
    },
  };
}

test("plugin update checker shares in-flight work and caches a fresh result", async () => {
  const host = harness();
  await Promise.all([host.checker.refresh(true), host.checker.refresh(true)]);
  await host.checker.refresh();

  assert.equal(host.checks, 1, "concurrent and fresh callers share one SDK check");
  assert.equal(host.releases, 1);
  assert.equal(host.checker.getState().outcome, "current");
  assert.deepEqual(host.checker.getRelease(), { tag: "v1.0.0", url: "https://example.test/v1.0.0", checkedAt: 1000, newer: false });
});

test("plugin update checker preserves the last verdict on a failed refresh", async () => {
  const host = harness();
  await host.checker.refresh(true);
  host.advance(70_000);
  host.failNextChecks();

  await host.checker.refresh(true);

  assert.equal(host.checker.getState().outcome, "current", "a transient failure must not remove a known update verdict");
  assert.equal(host.checker.getState().detail, "Update check failed: network unavailable");
  assert.deepEqual(host.warnings, ["plugin update check failed: network unavailable"]);
});

test("a check disposed in flight neither logs nor publishes a failed verdict", async () => {
  const host = harness();
  const inFlight = host.holdNextCheck();

  const pending = host.checker.refresh(true);
  assert.equal(host.checks, 1, "the SDK check must really be in flight before dispose");
  host.checker.dispose();
  inFlight.reject(Object.assign(new Error("stale API handle"), { name: "Error" }));
  await pending;

  assert.deepEqual(host.warnings, [], "a disposed checker must not warn about a check nobody waits for");
  assert.equal(host.checker.getState().outcome, "checking", "the pre-check state must survive a post-dispose failure");
  assert.equal(host.checker.getState().detail, null, "a disposed checker must not publish a failed verdict");
  assert.equal(host.checker.getRelease(), null);
});

test("a disposed checker starts no work", async () => {
  const host = harness();
  host.checker.dispose();

  await host.checker.refresh(true);

  assert.equal(host.checks, 0, "a forced refresh after dispose must not reach the SDK");
  assert.equal(host.releases, 0, "a disposed checker must not fetch a release either");
  assert.equal(host.checker.getState().outcome, "checking");
});

test("dispose is idempotent and later refreshes keep starting nothing", async () => {
  const host = harness();

  assert.doesNotThrow(() => {
    host.checker.dispose();
    host.checker.dispose();
  });

  await host.checker.refresh(true);
  await host.checker.refresh(true);

  assert.equal(host.checks, 0, "a repeated dispose must not reopen the checker");
  assert.deepEqual(host.warnings, []);
});

test("a verdict that lands after dispose is never written", async () => {
  const host = harness();
  const inFlight = host.holdNextCheck();

  const pending = host.checker.refresh(true);
  inFlight.resolve([{ id: "stelow", outcome: "update-available", installed: "1.0.0", candidate: { version: "2.0.0" } }]);
  host.checker.dispose();
  await pending;

  assert.equal(host.checker.getState().outcome, "checking", "a disposed checker must not write the SDK verdict");
  assert.equal(host.checker.getRelease(), null);
  assert.equal(host.releases, 0, "a disposed checker must not go on to look for a release");
});

test("a release discovered after dispose is never published", async () => {
  const host = harness();
  const inFlight = host.holdNextRelease();

  const pending = host.checker.refresh(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.releases, 1, "the release lookup must really be in flight before dispose");
  host.checker.dispose();
  inFlight.resolve({ tag: "v2.0.0", url: "https://example.test/v2.0.0" });
  await pending;

  assert.equal(host.checker.getRelease(), null, "a disposed checker must not publish a late release");
  assert.equal(host.checker.getState().outcome, "current", "the verdict already written before dispose stays");
});
