/**
 * Cardless `advance` through the REAL `advanceCli` with stubbed deps.
 *
 * A cardless run with exactly one legacy workflow (`.stelow/<date>/<dir>/`)
 * must re-root the helper to the discovered state dir — and `ensureArtifacts`
 * must see the same dir, or the guard checks a different tree than the helper
 * mutates. Several workflows refuse (exit 1, naming the count, helper never
 * runs); none keeps the old project-root behavior (`undefined` stateDir).
 *
 * Minimal harness in the `runtime-platform` style (the shared `cli-harness`
 * stubs `advanceCli` itself, so it cannot drive the real one): `projectRoot`
 * points at a `tmpdir()` fixture, `ensureArtifacts`/`runHelper` capture, the
 * rest are no-op stubs. Fixtures live under `os.tmpdir()`, never in the repo.
 */
import "./legacy-sdk-shim.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { advanceCli } = await import("../server/execution-advance-cli.ts");

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "stelow-legacy-cli-"));
  roots.push(root);
  return root;
}

function stateAt(root, ...segments) {
  const dir = join(root, ...segments);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.md"), "---\ncurrent_stage: triage\n---\n");
  return dir;
}

/** Deps with every card path stubbed out; the cardless run never touches them. */
function harness(root, { guard = null, helper = { code: 0, stdout: "advanced", stderr: "" } } = {}) {
  const calls = [];
  const deps = {
    errors: {
      cardNotFound: "card not found",
      cardArchived: "card archived",
      workspaceUnavailable: "workspace unavailable",
    },
    isArchivedCard: () => false,
    // Cardless: no thread, so no card — the run below must never ask for one.
    getCardByWorkerThread: () => undefined,
    cardWorkspace: async () => null,
    projectRoot: async () => root,
    stateDir: async () => null,
    ensureArtifacts: async (rootPath, stateDir) => {
      calls.push(["ensureArtifacts", rootPath, stateDir]);
      return guard;
    },
    questionGate: async () => null,
    runHelper: async (args, cwd, stateDir) => {
      calls.push(["runHelper", args, cwd, stateDir]);
      return helper;
    },
    updateCard: () => undefined,
    recordStageEvent: () => undefined,
    requestGatePreReview: async () => undefined,
  };
  const services = {
    prepareAdvance: async () => ({ route: null, note: "", evidence: "" }),
    dispatchAdvance: async () => ({ stdout: "", error: null }),
    applyBand: async () => undefined,
  };
  return { calls, deps, services };
}

const cardless = { threadId: null, projectId: "proj_1" };

test("a single legacy workflow re-roots both the guard and the helper to it", async () => {
  const root = fixtureRoot();
  const expected = stateAt(root, ".stelow", "2026-10-22", "sw-x");
  const { calls, deps, services } = harness(root);

  const result = await advanceCli(deps, services, ["advance", "context"], cardless);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    calls.filter(([name]) => name === "ensureArtifacts"),
    [["ensureArtifacts", root, expected]],
    "the guard checks the discovered dir, not the project root",
  );
  assert.deepEqual(
    calls.filter(([name]) => name === "runHelper"),
    [["runHelper", ["advance", "context"], root, expected]],
    "the helper runs in the discovered dir",
  );
});

test("ambiguous legacy workflows refuse before the helper runs", async () => {
  const root = fixtureRoot();
  stateAt(root, ".stelow", "2026-10-22", "sw-a");
  stateAt(root, ".stelow", "2026-10-22", "sw-b");
  const { calls, deps, services } = harness(root);

  const result = await advanceCli(deps, services, ["advance", "context"], cardless);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr ?? "", /2 legacy workflows/, "the refusal names the count");
  assert.deepEqual(
    calls.filter(([name]) => name === "runHelper"),
    [],
    "an ambiguous tree never lets the helper mutate anything",
  );
});

test("no legacy workflow runs the helper with no state dir, as before", async () => {
  const root = fixtureRoot();
  const { calls, deps, services } = harness(root);

  const result = await advanceCli(deps, services, ["advance", "context"], cardless);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    calls.filter(([name]) => name === "runHelper"),
    [["runHelper", ["advance", "context"], root, undefined]],
    "the old project-root behavior is preserved",
  );
});

console.log("legacy advance CLI ok: single re-roots guard and helper, ambiguous refuses, none keeps project root");
