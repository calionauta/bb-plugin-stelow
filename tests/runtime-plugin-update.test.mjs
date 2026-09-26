import assert from "node:assert/strict";
import test from "node:test";
import { createPluginUpdateChecker } from "../server/runtime/plugin-update.ts";

function harness() {
  let checks = 0;
  let releases = 0;
  let now = 1000;
  let failChecks = false;
  const warnings = [];
  const bb = {
    pluginId: "stelow",
    sdk: {
      plugins: {
        checkUpdates: async () => {
          checks += 1;
          if (failChecks) throw new Error("network unavailable");
          return [{ id: "stelow", outcome: "current", installed: "1.0.0", candidate: null }];
        },
      },
    },
    log: { warn: (message) => warnings.push(message) },
  };
  const checker = createPluginUpdateChecker({
    bb,
    installedVersion: "1.0.0",
    now: () => now,
    fetchRelease: async () => {
      releases += 1;
      return { tag: "v1.0.0", url: "https://example.test/v1.0.0" };
    },
  });
  return {
    checker,
    get checks() { return checks; },
    get releases() { return releases; },
    warnings,
    advance: (value) => { now = value; },
    failNextChecks: () => { failChecks = true; },
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
