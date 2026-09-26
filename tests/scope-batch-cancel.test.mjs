import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  acquireScopeClaims,
  addClaimWaiters,
  ensureCardClaimsTables,
  liveClaimsForWorkspace,
} from "../lib/card-claims.mjs";
import { activeExecutionRun, createExecutionRun, ensureExecutionRunTable } from "../lib/execution-run-ledger.mjs";
import { cancelBatch } from "../lib/scope-batch-cancel.mjs";

const db = new Database(":memory:");
db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
db.prepare("INSERT INTO cards (id) VALUES (?)").run("card-1");
ensureExecutionRunTable(db);
ensureCardClaimsTables(db);

const T0 = 5_000_000;
// One card running N scopes: a single in-flight execution run plus one
// batch-tagged claim per scope, one unscoped card claim, one workspace
// claim under a different scope label, and parked waiters both by this
// card and by a foreign card blocked on its files.
createExecutionRun(db, {
  id: "run-0",
  cardId: "card-1",
  projectId: "project-1",
  recipeId: "scope-batch",
  stage: "build",
  sourceHash: "sha256:batch",
  sourceText: "batch",
  argsText: "{}",
  adapter: "coordinator",
  workspaceId: "/repo",
  artifactRoot: "/repo/.stelow",
  originThreadId: "thread-1",
  runId: "native-0",
  now: T0,
});
const scopes = ["scope-a", "scope-b", "scope-c"];
for (const scopeId of scopes) {
  const acquired = acquireScopeClaims(db, {
    cardId: "card-1",
    batchId: "batch-1",
    scopeId,
    files: [`src/${scopeId}.ts`],
    effectiveCheckout: "/repo",
    nowMs: T0,
  });
  assert.equal(acquired.ok, true, `${scopeId} holds its batch claim`);
}
// Unscoped + workspace claims the old LIKE `batchId::%` sweep missed.
db.prepare(
  "INSERT INTO card_claims (workspace_path, file_path, card_id, scope, acquired_at, expires_at, fencing) VALUES (?, ?, ?, ?, ?, ?, ?)",
).run("/repo", "src/unscoped.ts", "card-1", null, T0, T0 + 60_000, 90);
db.prepare(
  "INSERT INTO card_claims (workspace_path, file_path, card_id, scope, acquired_at, expires_at, fencing) VALUES (?, ?, ?, ?, ?, ?, ?)",
).run("/repo", "src/manual.ts", "card-1", "hand-claim", T0, T0 + 60_000, 91);
// This card parked on a foreign file; a foreign card parked on this
// card's scope file (needs the release nudge).
addClaimWaiters(db, { cardId: "card-1", workspacePath: "/repo", files: ["src/foreign.ts"], scope: "batch-1::scope-a", nowMs: T0 });
addClaimWaiters(db, { cardId: "card-9", workspacePath: "/repo", files: ["src/scope-a.ts"], scope: "other", nowMs: T0 });

const cancelled = cancelBatch(db, { batchId: "batch-1", cardId: "card-1", scopes, nowMs: T0 + 10 });
assert.equal(cancelled.duplicate, false, "first cancel executes");
assert.equal(cancelled.cardId, "card-1", "one card owns the batch");
assert.equal(cancelled.cancelledScopes, 3, "all N in-flight scopes abort");
assert.equal(cancelled.releasedClaims.length, 5, "batch, unscoped, and workspace claims all release");
assert.ok(
  cancelled.releasedClaims.some((row) => row.file === "src/unscoped.ts"),
  "the unscoped claim releases (LIKE batchId::% would miss it)",
);
assert.equal(cancelled.clearedWaiters, 1, "the card's own parked waiter clears");
assert.ok(
  cancelled.notified.some((entry) => entry.cardId === "card-9" && entry.file === "src/scope-a.ts"),
  "the foreign waiter on a released file is nudge-listed",
);
assert.ok(
  cancelled.notified.every((entry) => entry.visibility === "agent-only"),
  "release nudges never page the human",
);
assert.equal(activeExecutionRun(db, "card-1"), null, "the card has no live run after cancel");
assert.equal(liveClaimsForWorkspace(db, { workspacePath: "/repo", nowMs: T0 + 11 }).length, 0, "no live holder survives");
assert.equal(
  db.prepare("SELECT COUNT(*) AS n FROM card_claim_waiters WHERE card_id = ?").get("card-1").n,
  0,
  "no parked waiter of the card survives",
);

// Completion dedupe: a second cancel returns the receipt, resurrects nothing.
const again = cancelBatch(db, { batchId: "batch-1", cardId: "card-1", scopes });
assert.equal(again.duplicate, true, "second cancel dedupes");
assert.equal(liveClaimsForWorkspace(db, { workspacePath: "/repo", nowMs: T0 + 12 }).length, 0, "no ghost holder after dedupe");

// Topology guard: a batch cancel without exactly one owning card refuses
// instead of spraying N cards.
assert.throws(
  () => cancelBatch(db, { batchId: "batch-orphan", scopes }),
  /exactly one card/,
  "cardless batch cancel refuses (N-cards x 1-scope is not this topology)",
);

// Mutation guard: sweeping only LIKE `batchId::%` would leave the unscoped
// and workspace claims live. The released-count pin above fails if the
// sweep narrows back to the batch tag.
assert.equal(cancelled.releasedClaims.length, 5, "full sweep is load-bearing (tag-only sweep -> 3)");

console.log("scope-batch-cancel: ok");
