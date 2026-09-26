import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { acquireScopeClaims, ensureCardClaimsTables } from "../lib/card-claims.mjs";
import { ensureExecutionRunTable } from "../lib/execution-run-ledger.mjs";
import {
  admitScopeBatchRun,
  cancelScopeBatchRun,
  claimScopeBatchRun,
  collectScopeBatchPilotReceiptsRun,
  evaluateScopeBatchPilotRun,
  finishScopeBatchRun,
  guardScopeBatchWrite,
  mergeScopeBatchRun,
  retryScopeBatchRun,
  verifyScopeBatchRun,
} from "../server/scope-batch.ts";
import { runScopeCommand } from "../server/scopes.ts";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const scopesSource = readFileSync(join(root, "server/scopes.ts"), "utf8");
const coordinatorSource = readFileSync(join(root, "server/scope-batch.ts"), "utf8");

// The server coordinator owns every scope-batch entrypoint: no production
// path reaches around it.
for (const symbol of [
  "computeScopePartitions",
  "acquireScopeClaims",
  "checkScopeWrite",
  "finishScope",
  "claimScopeRetry",
  "mergeScopesAtomically",
  "verifyParentMerge",
  "cancelBatch",
]) {
  assert.ok(coordinatorSource.includes(symbol), `server coordinator calls ${symbol}`);
}

// Coordinator-sequential only: the scope-batch path never fans work
// out. Concurrent dispatch would run scopes before file-claim and
// parent-merge safety is proven for fan-out.
assert.match(coordinatorSource, /NO_FANOUT/, "the coordinator marks its sequential section");
assert.doesNotMatch(coordinatorSource, /Promise\.all/, "no fan-out in the scope-batch coordinator");

// Admission refuses overlapping batches before any spawn.
{
  const refused = admitScopeBatchRun([
    { scopeId: "scope-a", targetFiles: ["src/a.ts"] },
    { scopeId: "scope-b", targetFiles: ["src/a.ts"] },
  ]);
  assert.equal(refused.admitted, false, "coordinator admission refuses overlap");
  assert.equal(refused.code, "PARTITION_OVERLAP", "admission names the overlap");
}

// Spawn claims sequentially and rolls back the first scope when the
// second conflicts, so a refused batch leaves no partial holders.
{
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const foreign = acquireScopeClaims(db, {
    cardId: "card-9", batchId: "batch-x", scopeId: "scope-z", files: ["src/taken.ts"], effectiveCheckout: "/repo", nowMs: Date.now(),
  });
  assert.equal(foreign.ok, true, "setup: foreign holder takes its file");
  const refused = claimScopeBatchRun(db, {
    cardId: "card-1", batchId: "batch-1", workspacePath: "/repo",
    scopes: [
      { scopeId: "scope-a", files: ["src/a.ts"] },
      { scopeId: "scope-b", files: ["src/taken.ts"] },
    ],
  });
  assert.equal(refused.ok, false, "conflicting batch refuses");
  assert.equal(refused.code, "SCOPE_BATCH_CONFLICT", "spawn refusal names the conflict");
  assert.deepEqual(refused.rolledBack, ["scope-a"], "the first scope rolls back");
  const live = db.prepare("SELECT COUNT(*) AS n FROM card_claims WHERE card_id = ?").get("card-1").n;
  assert.equal(live, 0, "no partial holder survives a refused spawn");
}

// Pre-write enforcement throws before any mutation lands.
{
  assert.throws(
    () => guardScopeBatchWrite(
      { scopeId: "batch-1::scope-b", file: "src/a.ts", checkout: "/repo" },
      [{ scopeId: "batch-1::scope-a", file: "src/a.ts", checkout: "/repo" }],
    ),
    /CLAIM_REQUIRED/,
    "unclaimed scope writes throw through the coordinator",
  );
}

// Cleanup releases exactly the finished scope.
{
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const claimed = claimScopeBatchRun(db, {
    cardId: "card-1", batchId: "batch-1", workspacePath: "/repo", scopes: [{ scopeId: "scope-a", files: ["src/a.ts"] }],
  });
  assert.equal(claimed.ok, true, "setup: scope claims");
  const done = finishScopeBatchRun(db, { batchId: "batch-1", scopeId: "scope-a", cardId: "card-1", outcome: "succeeded" });
  assert.equal(done.released.length, 1, "cleanup releases the scope claim");
}

// Retry executes once per key through the coordinator.
{
  const db = new Database(":memory:");
  let writes = 0;
  const run = () => { writes += 1; return "ok"; };
  retryScopeBatchRun(db, { batchId: "batch-1", scopeId: "scope-a", retryKey: "k-1", run });
  const replay = retryScopeBatchRun(db, { batchId: "batch-1", scopeId: "scope-a", retryKey: "k-1", run });
  assert.equal(replay.duplicate, true, "coordinator retry replays without re-executing");
  assert.equal(writes, 1, "single workspace effect");
}

// Merge refuses failed children, cancelled batches, and lock contention.
{
  const failed = mergeScopeBatchRun("batch-1", [
    { scopeId: "scope-a", files: { "src/a.ts": "a" }, status: "succeeded" },
    { scopeId: "scope-b", files: { "src/b.ts": "b" }, status: "failed" },
  ], {});
  assert.equal(failed.ok, false, "coordinator merge refuses failed children");
  assert.equal(failed.code, "SCOPE_FAILED", "merge names SCOPE_FAILED");
  const cancelled = mergeScopeBatchRun("batch-1", [
    { scopeId: "scope-a", files: { "src/a.ts": "a" }, status: "succeeded" },
  ], {}, {}, { cancelled: true });
  assert.equal(cancelled.code, "BATCH_CANCELLED", "cancelled batches refuse the merge");
}

// Verify refuses stale verification through the coordinator.
{
  const stale = verifyScopeBatchRun("batch-1", { batchId: "batch-2", mergeCommit: "m", verifiedAt: 2, mergeAt: 1 }, "m");
  assert.equal(stale.ok, false, "stale verification refuses");
  assert.equal(stale.code, "VERIFICATION_STALE", "verify names VERIFICATION_STALE");
}

// Cancel sweeps the whole 1-card batch through the coordinator.
{
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO cards (id) VALUES (?)").run("card-1");
  ensureExecutionRunTable(db);
  ensureCardClaimsTables(db);
  const claimed = claimScopeBatchRun(db, {
    cardId: "card-1", batchId: "batch-1", workspacePath: "/repo",
    scopes: [{ scopeId: "scope-a", files: ["src/a.ts"] }, { scopeId: "scope-b", files: ["src/b.ts"] }],
  });
  assert.equal(claimed.ok, true, "setup: batch claims");
  const cancelled = cancelScopeBatchRun(db, { batchId: "batch-1", cardId: "card-1", scopes: ["scope-a", "scope-b"] });
  assert.equal(cancelled.duplicate, false, "coordinator cancel executes");
  assert.equal(cancelled.releasedClaims.length, 2, "every scope claim releases");
}

// Production triggers: the card lifecycle sweeps batch claims, and the scope
// CLI carries the database into the extracted command module. Each trigger
// lives in its own owner now — the lifecycle slice and the CLI wiring.
const lifecycleSource = readFileSync(join(root, "server/runtime/card-lifecycle.ts"), "utf8");
const cliWiringSource = readFileSync(join(root, "server/runtime/wiring/cli-surfaces.ts"), "utf8");
assert.match(lifecycleSource, /batchIdsForCard\(db, cardId\)/, "the card lifecycle discovers the card batches");
assert.match(lifecycleSource, /cancelBatch\(batchId, cardId, reason\)/, "every batch is cancelled on the card lifecycle's way out");
assert.match(lifecycleSource, /deps\.cancelScopeBatches\(cardId, "card-archived"\)/, "archiving sweeps scope batches");
assert.match(lifecycleSource, /deps\.cancelScopeBatches\(cardId, "card-deleted"\)/, "deleting sweeps scope batches");
const scopeDbWiring = /db: core\.db,\s*\n\s*\};\s*\n\s*return \(argv, context\) => runScopeCommand/;
assert.match(
  cliWiringSource,
  scopeDbWiring,
  "the scope CLI passes the database to runScopeCommand",
);
assert.match(scopesSource, /scopeStartGate\(deps\.db/, "scope start passes through the admission gate");
assert.match(scopesSource, /scopeDoneGate\(deps\.db/, "scope done passes through the proof gate");
{
  const gateAt = scopesSource.indexOf("scopeStartGate(deps.db");
  const helperAt = scopesSource.indexOf('runHelper(\n    ["scope"');
  assert.ok(gateAt >= 0 && gateAt < helperAt, "the start gate runs before the helper mutates");
}

// Live scope CLI: an overlapping start refuses before the helper runs;
// a disjoint start claims; done proves and releases; a lapsed done
// refuses CLAIM_REQUIRED.
{
  const dir = mkdtempSync(join(tmpdir(), "stelow-batch-"));
  const card = { id: "card-1", dir_hash: null };
  const writeScopes = (scopes) => writeFileSync(join(dir, "stelow.json"), JSON.stringify({ workflows: [{ workflowId: "card-1", scopes }] }));
  writeScopes([
    { id: "scope-a", status: "in-progress", targetFiles: ["src/shared.ts"] },
    { id: "scope-b", status: "pending", targetFiles: ["src/shared.ts", "src/b.ts"] },
    { id: "scope-c", status: "pending", targetFiles: ["src/c.ts"] },
  ]);
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const seed = acquireScopeClaims(db, {
    cardId: "card-1", batchId: "batch-1", scopeId: "scope-a", files: ["src/shared.ts"], effectiveCheckout: dir, nowMs: Date.now(),
  });
  assert.equal(seed.ok, true, "setup: sibling scope holds its batch claim");
  const helperCalls = [];
  const deps = {
    bb: { realtime: { publish: () => undefined } },
    getCardByWorkerThread: () => card,
    cardWorkspace: async () => ({ path: dir }),
    projectRoot: async () => dir,
    workflowStateDir: async () => null,
    ensureProjectArtifacts: async () => null,
    runHelper: async (args) => { helperCalls.push(args); return { code: 0, stdout: "ok", stderr: "" }; },
    recordTrackableEvent: () => undefined,
    db,
  };
  const clashing = await runScopeCommand(["scope", "start", "--scope", "scope-b"], { threadId: "t-1" }, deps);
  assert.equal(clashing.exitCode, 1, "overlapping start refuses");
  assert.match(clashing.stderr ?? "", /PARTITION_OVERLAP/, "refusal names the overlap");
  assert.equal(helperCalls.length, 0, "a refused start never reaches the helper");
  const clean = await runScopeCommand(["scope", "start", "--scope", "scope-c"], { threadId: "t-1" }, deps);
  assert.deepEqual(clean, { exitCode: 0, stdout: "ok" }, "disjoint start proceeds");
  assert.equal(helperCalls.length, 1, "an admitted start reaches the helper once");
  const tag = db.prepare("SELECT COUNT(*) AS n FROM card_claims WHERE card_id = ? AND scope = ?").get("card-1", "batch-1::scope-c").n;
  assert.equal(tag, 1, "an admitted start claims its files");
  const done = await runScopeCommand(["scope", "done", "--scope", "scope-c"], { threadId: "t-1" }, deps);
  assert.equal(done.exitCode, 0, "a proven done completes");
  const released = db.prepare("SELECT COUNT(*) AS n FROM card_claims WHERE card_id = ? AND scope = ?").get("card-1", "batch-1::scope-c").n;
  assert.equal(released, 0, "done releases exactly its scope claims");
  db.prepare("DELETE FROM card_claims WHERE card_id = ? AND scope = ?").run("card-1", "batch-1::scope-a");
  db.prepare(
    "INSERT INTO card_claims (workspace_path, file_path, card_id, scope, acquired_at, expires_at, fencing) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(dir, "src/keep.ts", "card-1", "batch-1::scope-keep", Date.now(), Date.now() + 60_000, 7);
  const lapsed = await runScopeCommand(["scope", "done", "--scope", "scope-a"], { threadId: "t-1" }, deps);
  assert.equal(lapsed.exitCode, 1, "a lapsed done refuses");
  assert.match(lapsed.stderr ?? "", /CLAIM_REQUIRED/, "lapse names the missing claim");
}

// Pilot boundary: native fan-out ONLY for disjoint scopes with
// satisfied claims, proven capabilities, and the pilot flag on.
// Every gate failure falls back to coordinator-sequential with no
// partial fan-out; overlapping scopes never fan out.
{
  const disjoint = [
    { scopeId: "scope-a", targetFiles: ["src/a.ts"] },
    { scopeId: "scope-b", targetFiles: ["src/b.ts"] },
  ];
  const capable = { "file-claims": true, "isolated-workspace": true };
  const admitted = evaluateScopeBatchPilotRun({
    scopes: disjoint,
    satisfiedScopeIds: ["scope-a", "scope-b"],
    nativeCapabilities: capable,
    nativePilotAllowed: true,
  });
  assert.equal(admitted.decision.mode, "native", "pilot admits disjoint satisfied-claims batch");
  assert.equal(admitted.admission.admitted, true, "pilot admission passes disjoint partitions");

  const overlapping = evaluateScopeBatchPilotRun({
    scopes: [
      { scopeId: "scope-a", targetFiles: ["src/shared.ts"] },
      { scopeId: "scope-b", targetFiles: ["src/shared.ts"] },
    ],
    satisfiedScopeIds: ["scope-a", "scope-b"],
    nativeCapabilities: capable,
    nativePilotAllowed: true,
  });
  assert.equal(overlapping.decision.mode, "coordinator-sequential", "overlapping scopes never fan out");
  assert.equal(overlapping.decision.code, "PARTITION_OVERLAP", "overlap fallback names its gate");

  for (const [name, args, code] of [
    [
      "flag off rolls back",
      {
        scopes: disjoint,
        satisfiedScopeIds: ["scope-a", "scope-b"],
        nativeCapabilities: capable,
        nativePilotAllowed: false,
      },
      "PILOT_DISABLED",
    ],
    [
      "live host capabilities force sequential",
      {
        scopes: disjoint,
        satisfiedScopeIds: ["scope-a", "scope-b"],
        nativeCapabilities: {},
        nativePilotAllowed: true,
      },
      "PILOT_CAPABILITY_GATE",
    ],
    [
      "missing claim rejects the batch",
      {
        scopes: disjoint,
        satisfiedScopeIds: ["scope-a"],
        nativeCapabilities: capable,
        nativePilotAllowed: true,
      },
      "PILOT_ADMISSION_GATE",
    ],
  ]) {
    const fallback = evaluateScopeBatchPilotRun(args);
    assert.equal(fallback.decision.mode, "coordinator-sequential", `pilot falls back: ${name}`);
    assert.equal(fallback.decision.code, code, `fallback names its gate: ${name}`);
  }

  // One-flag rollback: the recorded waiver value restores sequential
  // for the exact batch the pilot just admitted.
  const rolledBack = evaluateScopeBatchPilotRun({
    scopes: disjoint,
    satisfiedScopeIds: ["scope-a", "scope-b"],
    nativeCapabilities: capable,
    nativePilotAllowed: false,
  });
  assert.equal(rolledBack.decision.mode, "coordinator-sequential", "one flag restores sequential");
}

// Pilot receipts land per scope: every scope returns claim
// verification, files touched, and an artifact manifest; the merge
// stays refused until all receipts collect, then post-merge
// verification still gates success.
{
  const scopes = [
    { scopeId: "scope-a", targetFiles: ["src/a.ts"] },
    { scopeId: "scope-b", targetFiles: ["src/b.ts"] },
  ];
  const complete = collectScopeBatchPilotReceiptsRun(
    [
      { scopeId: "scope-a", claimVerified: true, filesTouched: ["src/a.ts"], artifacts: ["a.md"] },
      { scopeId: "scope-b", claimVerified: true, filesTouched: ["src/b.ts"], artifacts: ["b.md"] },
    ],
    scopes,
  );
  assert.equal(complete.ok, true, "per-scope receipts collect");
  assert.deepEqual(Object.keys(complete.receiptsByScope).sort(), ["scope-a", "scope-b"], "receipts land per scope");

  const incomplete = collectScopeBatchPilotReceiptsRun(
    [{ scopeId: "scope-a", claimVerified: true, filesTouched: ["src/a.ts"], artifacts: ["a.md"] }],
    scopes,
  );
  assert.equal(incomplete.ok, false, "a missing receipt refuses the merge");
  assert.equal(incomplete.code, "RECEIPT_MISSING", "missing receipt falls back to sequential retry");

  const unverified = collectScopeBatchPilotReceiptsRun(
    [
      { scopeId: "scope-a", claimVerified: false, filesTouched: ["src/a.ts"], artifacts: ["a.md"] },
      { scopeId: "scope-b", claimVerified: true, filesTouched: ["src/b.ts"], artifacts: ["b.md"] },
    ],
    scopes,
  );
  assert.equal(unverified.ok, false, "an unverified receipt refuses the merge");

  // Parent merge gate: receipts collected, then the coordinator merges
  // only clean scopes and verifies the parent before success.
  const merged = mergeScopeBatchRun("batch-pilot", [
    { scopeId: "scope-a", files: { "src/a.ts": "a" }, status: "succeeded" },
    { scopeId: "scope-b", files: { "src/b.ts": "b" }, status: "succeeded" },
  ], {});
  assert.equal(merged.ok, true, "clean pilot scopes merge");
  const verified = verifyScopeBatchRun(
    "batch-pilot",
    { batchId: "batch-pilot", mergeCommit: "m", verifiedAt: 2, mergeAt: 1 },
    "m",
  );
  assert.equal(verified.ok, true, "post-merge verification gates pilot success");
  const stale = verifyScopeBatchRun("batch-pilot", { batchId: "batch-other", mergeCommit: "m", verifiedAt: 2, mergeAt: 1 }, "m");
  assert.equal(stale.ok, false, "stale verification refuses pilot success and forces sequential retry");
}

console.log("scope-batch-wiring: ok");
