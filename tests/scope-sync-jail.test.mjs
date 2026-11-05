import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname, relative } from "node:path";
import test from "node:test";
import { runScopeHistorySync } from "../server/runtime/scope-history-sync.ts";

function fixture(t) {
  const scratch = fs.mkdtempSync("/tmp/stelow-sync-jail-tests-");
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = join(scratch, "project");
  const stateDir = join(root, ".stelow", "2026-11-05", "fixture");
  fs.mkdirSync(join(stateDir, "plans"), { recursive: true });
  const stateText = "---\nworkflow_id: card_fixture\ncurrent_stage: execution\n---\n";
  fs.writeFileSync(join(stateDir, "state.md"), stateText);
  fs.writeFileSync(join(stateDir, "plans", "spec-tech_v2.md"), "[SCOPE-1] Original\n[TYPE] feature\n");
  const workflow = {
    workflowId: "card_fixture", name: "fixture", dirHash: "fixture", created: "2026-11-05T00:00:00Z",
    status: "in-progress", specTechFile: "spec-tech_v1.md", scopes: [{ id: "scope-1", name: "Original", tasks: [] }],
  };
  fs.writeFileSync(join(root, "stelow.json"), JSON.stringify({ workflows: [workflow] }));
  return { scratch, root, stateDir, stateText, calls: [], writes: [], outsideReads: [] };
}

async function attempt(f, stateDir) {
  const originalRead = fs.readFileSync;
  // Observe actual external bytes, restoring the built-in binding even after a refusal.
  fs.readFileSync = function (path, ...args) {
    const actual = fs.realpathSync(path);
    if (relative(f.scratch, actual).startsWith("outside")) f.outsideReads.push(actual);
    return originalRead.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const invoke = async (args, cwd) => {
      f.calls.push(args);
      if (args[0] === "sync-scopes") {
        const path = join(cwd, "stelow.json");
        const tracker = JSON.parse(fs.readFileSync(path, "utf8"));
        tracker.workflows[0].specTechFile = "spec-tech_v2.md";
        fs.writeFileSync(path, JSON.stringify(tracker));
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const files = { write: async (request) => {
      f.writes.push(request);
      if (request.path === join(f.root, "stelow.json")) return { outcome: "conflict" };
      fs.mkdirSync(dirname(request.path), { recursive: true });
      fs.writeFileSync(request.path, request.content);
      return { outcome: "written" };
    } };
    return await runScopeHistorySync(["sync-scopes", "--preserve-history"], f.root, stateDir, invoke, files);
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
  }
}

function assertEarlyRefusal(f, result) {
  assert.equal(result.code, 1);
  assert.deepEqual(f.outsideReads, [], "sync must refuse before reading bytes outside its project");
  assert.deepEqual(f.calls, [], "a rejected path must never reach the parser or reservations");
  assert.deepEqual(f.writes, [], "external bytes must never be copied into a project backup");
  assert.equal(fs.existsSync(join(f.root, ".stelow-history")), false);
}

test("an external tracker symlink refuses before reading or copying its bytes", async (t) => {
  const f = fixture(t);
  const tracker = join(f.root, "stelow.json");
  const outside = join(f.scratch, "outside-tracker.json");
  fs.renameSync(tracker, outside);
  fs.symlinkSync(outside, tracker);
  assertEarlyRefusal(f, await attempt(f, f.stateDir));
});

test("a supplied state directory outside the project refuses before its owner is read", async (t) => {
  const f = fixture(t);
  const outside = join(f.scratch, "outside-state");
  fs.mkdirSync(outside);
  fs.writeFileSync(join(outside, "state.md"), f.stateText);
  assertEarlyRefusal(f, await attempt(f, outside));
});

for (const explicit of [true, false]) {
  test(`owned state.md cannot read outside through a symlink with ${explicit ? "explicit" : "implicit"} owner`, async (t) => {
    const f = fixture(t);
    const state = join(f.stateDir, "state.md");
    const outside = join(f.scratch, "outside-state.md");
    fs.renameSync(state, outside);
    fs.symlinkSync(outside, state);
    assertEarlyRefusal(f, await attempt(f, explicit ? f.stateDir : undefined));
  });
}
