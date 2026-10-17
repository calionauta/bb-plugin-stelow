import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { canBulkArchive, canBulkDelete, canBulkStart, partitionByEligibility } from "../lib/bulk-eligibility.mjs";
import { runInBatches } from "../lib/bulk-batch.mjs";
import { isPathWithinRoot, resolveWithinRoot } from "../lib/path-jail.mjs";
import { flagValue } from "../lib/cli-argv.mjs";
import { scopeElapsedMs } from "../lib/scope-elapsed.mjs";
import { scopeCommandUsage } from "../lib/scope-command.mjs";
import { scopeClaimTag } from "../lib/card-claims.mjs";
import { scopeClaimTag as partitionScopeClaimTag } from "../lib/scope-partition.mjs";
import { rowIsOwnScopeClaim } from "../lib/scope-claim-room.mjs";
import { cacheablePrefix, clauseCost, ruleSentences } from "../lib/prompt-budget.mjs";
import { headingWords } from "../lib/option-anchor.mjs";
import { isCanonicalTerm } from "../lib/vocabulary-compat.mjs";
import { stripQuotes, validateGapEvidence } from "../lib/gap-evidence.mjs";
import { validateDebtExpiry } from "../lib/gap-debt.mjs";
import { validateBoundedText } from "../lib/draft-burst.mjs";
import { truncateCause } from "../lib/worker-failure.mjs";
import { diffGateWaits, gateSelected, interfaceRequiresHuman, planGateWaits, scopeRequiresHuman } from "../lib/review-gates.mjs";
import { gateWaitsStage } from "../lib/stage-skips.mjs";
import { lightweightColumnForStatus } from "../lib/tracks.mjs";
import { filterAndGroupTrackCards, trackCardMatches, trackLabelsById, trackPresetFor } from "../lib/track-panel-state.mjs";
import { defaultModelFor, providerById, providerSchema, providerTakesModel } from "../lib/decision-api.mjs";
import { resolveEvidenceSufficiency } from "../lib/skill-criteria.mjs";
import { findByKey } from "../lib/artifact-contract-lookup.mjs";
import { recipeIds } from "../lib/recipe-catalog.mjs";
import { isRecipeTaskActive } from "../lib/recipe-width.mjs";
import { clientById, isUiDesignMcpId } from "../lib/ui-design-mcp.mjs";
import { publicationSource } from "../lib/vcs-publication.mjs";
import { wireFacts } from "../lib/card-briefing.mjs";
import { hasRecordedIntegration } from "../lib/integration-pending.mjs";
import { isLedgerHealEnabled } from "../lib/migration-ledger-heal.mjs";
import { isWorkIntegrated } from "../lib/discard-policy.mjs";
import { runStatusPhrase } from "../lib/execution-run-ledger.mjs";
import { ensureExecutionRunTable, getExecutionRun, markExecutionNeedsInputSent } from "../lib/execution-run-ledger.mjs";
import { runUpdates } from "../lib/native-run.mjs";
import { declaredStages } from "../lib/transition-facts.mjs";
import { questionInboxDedupeKey, questionSyncKeys } from "../lib/inbox-events.mjs";
import { errorInboxKeyPrefix } from "../lib/inbox-error-event.mjs";
import { acquireScopeMergeLock, isScopeMergeLocked, releaseScopeMergeLock } from "../lib/scope-merge.mjs";
import { readShapeVersion } from "../lib/scope-map-freshness.mjs";
import { ensureScopeBatchCancelTables } from "../lib/scope-batch-cancel.mjs";
import { ensureScopeRetryTables } from "../lib/scope-retry.mjs";
import {
  cardSubPath,
  inboxCardSubPath,
  parseStelowSubPath,
  trackOfCard,
  trackRootSubPath,
  trackTitle,
} from "../components/panel/stelow-route.mjs";
import { consumeStelowReturnFocusCardId, rememberStelowReturnFocusCardId } from "../components/panel/stelow-focus.mjs";
import { parseExecutionRunSubPath } from "../lib/execution-deep-link.mjs";

// --- bulk eligibility: bulk actions refuse the wrong lifecycle state ---
assert.deepEqual(canBulkStart(null), { ok: false, reason: "not found" });
assert.deepEqual(canBulkStart({ status: "archived" }), { ok: false, reason: "archived" });
assert.deepEqual(canBulkStart({ status: "completed" }), { ok: false, reason: "completed" });
assert.deepEqual(canBulkStart({ status: "doing", activity: "running" }), { ok: false, reason: "running" });
assert.deepEqual(canBulkStart({ status: "doing", worker_thread_id: "thr_1" }), { ok: false, reason: "worker active" });
assert.deepEqual(canBulkStart({ status: "doing" }), { ok: true, reason: null });
assert.deepEqual(canBulkArchive({ status: "archived" }), { ok: false, reason: "already archived" });
assert.deepEqual(canBulkArchive({ status: "doing" }), { ok: true, reason: null });
assert.deepEqual(canBulkDelete({ status: "doing" }), { ok: false, reason: "only archived" });
assert.deepEqual(canBulkDelete({ status: "archived" }), { ok: true, reason: null });
{
  const split = partitionByEligibility(
    [{ id: "a", status: "doing" }, { id: "b", status: "archived" }],
    (card) => canBulkArchive(card),
  );
  assert.deepEqual(split.eligible.map((card) => card.id), ["a"]);
  assert.equal(split.skipped.length, 1);
  assert.equal(split.skipped[0].reason, "already archived");
}

// --- bulk batching: one failing batch does not sink the others ---
{
  const out = await runInBatches(async (batch) => ({ succeeded: batch }), ["a", "b"]);
  assert.deepEqual(out, { succeeded: ["a", "b"], failed: [] });
  const failing = await runInBatches(async () => { throw new Error("boom"); }, ["a", "b"]);
  assert.deepEqual(failing.succeeded, []);
  assert.equal(failing.failed.length, 2);
  assert.match(failing.failed[0].error, /boom/);
}

// --- path jail: escapes resolve to null, never to the host ---
assert.equal(resolveWithinRoot("/root", "a"), "/root/a");
assert.equal(resolveWithinRoot("/root", "../escape"), null);
assert.equal(resolveWithinRoot("/root", "/etc/passwd"), null);
assert.equal(isPathWithinRoot("/root", "sub/dir"), true);
assert.equal(isPathWithinRoot("/root", "../escape"), false);

// --- argv + scope command surface ---
assert.equal(flagValue(["--scope", "s1", "--json"], "--scope"), "s1");
assert.equal(flagValue(["--scope", "s1"], "--missing"), undefined);
assert.match(scopeCommandUsage(), /^Usage: bb stelow scope/);

// --- scope timing: completed scopes freeze, idle ones read null ---
assert.equal(scopeElapsedMs({ startedAt: 1000, record: { completedAt: 2500 } }), 1500);
assert.equal(scopeElapsedMs({ startedAt: 1000, status: "in-progress" }, 6000), 5000);
assert.equal(scopeElapsedMs({}), null);
assert.equal(scopeElapsedMs({ startedAt: 1000, status: "pending" }, 6000), null);

// --- claim tags: batch scope identity is `batch::scope`, bare otherwise ---
assert.equal(scopeClaimTag("batch_1", "scope_2"), "batch_1::scope_2");
assert.equal(scopeClaimTag(null, "scope_2"), "scope_2");
assert.equal(scopeClaimTag(null, null), null);
assert.equal(partitionScopeClaimTag("batch_1", "scope_2"), "batch_1::scope_2");

// --- claim room: a tagged row is this scope's only when the tail matches ---
assert.equal(
  rowIsOwnScopeClaim({ card_id: "c", scope: null, file_path: "f" }, { ownerId: "c", scopeId: "s", targets: ["f"] }),
  true,
);
assert.equal(
  rowIsOwnScopeClaim({ card_id: "other", scope: null, file_path: "f" }, { ownerId: "c", scopeId: "s", targets: ["f"] }),
  false,
);
assert.equal(
  rowIsOwnScopeClaim({ card_id: "c", scope: "batch_1::s" }, { ownerId: "c", scopeId: "s", targets: [] }),
  true,
);
assert.equal(
  rowIsOwnScopeClaim({ card_id: "c", scope: "batch_1::other" }, { ownerId: "c", scopeId: "s", targets: [] }),
  false,
);

// --- prompt budget: shared prefix length, clause cost, sentence floor ---
assert.equal(cacheablePrefix("abcdef", "abcxyz"), 3);
assert.equal(cacheablePrefix("abc", "xyz"), 0);
{
  const cost = clauseCost("hello world");
  assert.equal(cost.length, 11);
  assert.ok(Number.isInteger(cost.tokens) && cost.tokens > 0);
}
{
  const sentences = ruleSentences(
    "This opening sentence is definitely longer than forty characters. Short one. This closing sentence is also longer than forty characters.",
  );
  assert.equal(sentences.length, 2);
}

// --- option anchors split on words, not characters ---
assert.deepEqual(headingWords("Hybrid A+C"), ["hybrid", "a", "c"]);
assert.deepEqual(headingWords(""), []);

// --- vocabulary freeze: canonical terms pass, legacy aliases do not ---
assert.equal(isCanonicalTerm("stage"), true);
assert.equal(isCanonicalTerm("track"), false);
assert.equal(isCanonicalTerm(42), false);

// --- gap evidence: quotes strip, malformed shapes refuse with a code ---
assert.equal(stripQuotes('"quoted"'), "quoted");
assert.equal(stripQuotes("'single'"), "single");
assert.equal(stripQuotes("  bare  "), "bare");
assert.equal(validateGapEvidence({ evidenceError: null }), null);
{
  const refusal = validateGapEvidence({ evidenceError: "callers must be a number" });
  assert.equal(refusal.code, "gap-evidence-shape");
}

// --- debt expiry: absent and well-formed pass, malformed refuses ---
assert.equal(validateDebtExpiry({ expires: null }), null);
assert.equal(validateDebtExpiry({ expires: "2030-01-01" }), null);
{
  const refusal = validateDebtExpiry({ expires: "not-a-date" });
  assert.equal(refusal.code, "gap-incomplete-row");
}

// --- bounded drafts: empty refuses, overflow truncates with a note ---
{
  const ok = validateBoundedText("  hello  ", { maxChars: 10, emptyError: "E", truncatedNote: "T" });
  assert.deepEqual(ok, { ok: true, text: "hello", truncated: false });
  const empty = validateBoundedText("   ", { maxChars: 10, emptyError: "E", truncatedNote: "T" });
  assert.equal(empty.ok, false);
  const over = validateBoundedText("abcdefghijklmnop", { maxChars: 10, emptyError: "E", truncatedNote: "T" });
  assert.equal(over.truncated, true);
  assert.match(over.text, /\[T at 10 chars\]/);
}

// --- failure causes collapse whitespace and cap at 180 chars ---
assert.equal(truncateCause("  a   b "), "a b");
assert.equal(truncateCause(""), null);
{
  const long = truncateCause("x".repeat(300));
  assert.ok(long.endsWith("…") && long.length <= 180);
}

// --- review gates: set predicates, never the ladder ---
assert.equal(gateSelected(["spec", "tech"], "tech"), true);
assert.equal(gateSelected("Auto", "tech"), false);
assert.equal(interfaceRequiresHuman(["interface"]), true);
assert.equal(interfaceRequiresHuman([]), false);
assert.equal(scopeRequiresHuman(["scope"]), true);
assert.equal(planGateWaits(["tech"]), true);
assert.equal(planGateWaits(["diff"]), false);
assert.equal(diffGateWaits(["diff"]), true);
assert.equal(diffGateWaits(["tech"]), false);
assert.equal(gateWaitsStage("plan-gate", ["tech"]), true);
assert.equal(gateWaitsStage("diff-gate", ["tech"]), false);
assert.equal(gateWaitsStage("selection", ["tech"]), false);
assert.equal(gateWaitsStage("shape", ["tech"]), true);

// --- lightweight board projection ---
assert.equal(lightweightColumnForStatus("archived"), "archived");
assert.equal(lightweightColumnForStatus("completed"), "done");
assert.equal(lightweightColumnForStatus("in-progress"), "doing");
assert.equal(lightweightColumnForStatus("pending"), "inbox");

// --- track panel grouping, labels, and preset fallback ---
assert.equal(trackCardMatches({ projectId: "p1" }, { projectIds: ["p1"] }), true);
assert.equal(trackCardMatches({ projectId: "p1" }, { projectIds: ["p2"] }), false);
{
  const groups = filterAndGroupTrackCards(
    [
      { id: "a", projectId: "p1", status: "completed", updatedAt: 2 },
      { id: "b", projectId: "p1", status: "in-progress", updatedAt: 5 },
      { id: "c", projectId: "p2", status: "completed", updatedAt: 9 },
    ],
    { columns: ["inbox", "doing", "done"], projectIds: ["p1"] },
  );
  assert.deepEqual(groups.done.map((card) => card.id), ["a"]);
  assert.deepEqual(groups.doing.map((card) => card.id), ["b"]);
}
assert.equal(trackLabelsById([{ id: "a", label: "A" }]).get("a"), "A");
{
  const fallback = trackPresetFor([{ id: "p1", isDefault: true }, { id: "p2" }], [], "research");
  assert.equal(fallback.preset.id, "p1");
  assert.equal(fallback.hasBandPreset, false);
  const assigned = trackPresetFor(
    [{ id: "p1", isDefault: true }, { id: "p2" }],
    [{ band: "research", presetId: "p2" }],
    "research",
  );
  assert.equal(assigned.preset.id, "p2");
  assert.equal(assigned.hasBandPreset, true);
}

// --- decision providers: unknown ids fall back, never throw ---
assert.equal(providerById("simplejev")?.id, "simplejev");
assert.equal(providerById("no-such-provider"), null);
assert.equal(typeof providerSchema("no-such-provider"), "string");
assert.equal(typeof providerTakesModel("no-such-provider"), "boolean");
assert.equal(typeof defaultModelFor("no-such-provider"), "string");
assert.deepEqual(
  resolveEvidenceSufficiency({ apiNoul: "unanswered", routeAt: 0.5 }),
  { sufficient: true, source: "rules" },
);
assert.equal(resolveEvidenceSufficiency({ apiNoul: 0.9, routeAt: 0.5 }).sufficient, true);
assert.equal(resolveEvidenceSufficiency({ apiNoul: 0.1, routeAt: 0.5 }).sufficient, false);

// --- contract lookup, catalog, and recipe activation ---
assert.deepEqual(findByKey([{ id: "a" }, { id: "b" }], "id", "b"), { id: "b" });
assert.equal(findByKey([{ id: "a" }], "id", "zzz"), null);
assert.equal(findByKey([], "id", 42), null);
{
  const ids = recipeIds();
  assert.ok(Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string"));
}
assert.equal(isRecipeTaskActive({ when: "always" }), true);
assert.equal(isRecipeTaskActive({ when: "findings_exist" }), true);
assert.equal(isRecipeTaskActive({ when: "partition_is_safe" }, {}), false);
assert.equal(isRecipeTaskActive({ when: "partition_is_safe" }, { partitionSafe: true }), true);

// --- ui-design-mcp registry: unknown ids read null/false ---
assert.equal(clientById("no-such-client"), null);
assert.equal(isUiDesignMcpId("no-such-server"), false);

// --- publication source names the worker surface ---
assert.equal(publicationSource(null), "Project source");
assert.equal(publicationSource({ isWorktree: true, branchName: "stelow/abc" }), "Worker worktree · stelow/abc");
assert.equal(publicationSource({}), "Worker checkout");

// --- briefing wire facts always carry every key ---
{
  const [full, sparse] = wireFacts([
    { kind: "k", at: 1, text: "t", stage: "s", open: true },
    { kind: "k2" },
  ]);
  assert.deepEqual(full, { kind: "k", at: 1, text: "t", stage: "s", open: true });
  assert.deepEqual(sparse, { kind: "k2", at: undefined, text: null, stage: null, open: null });
}
assert.deepEqual(wireFacts(null), []);

// --- integration ledger: merges count, anything else does not ---
{
  const db = new Database(":memory:");
  db.exec("CREATE TABLE publication_events (card_id TEXT NOT NULL, action TEXT NOT NULL)");
  assert.equal(hasRecordedIntegration(db, "c1"), false);
  db.prepare("INSERT INTO publication_events VALUES ('c1', 'squash_merge')").run();
  assert.equal(hasRecordedIntegration(db, "c1"), false);
  db.prepare("INSERT INTO publication_events VALUES ('c1', 'pull_request_merge')").run();
  assert.equal(hasRecordedIntegration(db, "c1"), true);
  db.close();
  assert.equal(hasRecordedIntegration(new Database(":memory:"), "c1"), false);
}

// --- ledger heal kill switch + worktree integration proofs ---
assert.equal(isLedgerHealEnabled({}), true);
assert.equal(isLedgerHealEnabled({ STELOW_HEAL_LEDGER: "0" }), false);
assert.equal(isWorkIntegrated({ remoteMerged: true }), true);
assert.equal(isWorkIntegrated({ treeMatchesBase: true }), true);
assert.equal(isWorkIntegrated({}), false);

// --- run ledger: sentence register + needs-input stamp round-trip ---
assert.equal(runStatusPhrase("needs_input"), "waiting on a decision");
assert.equal(runStatusPhrase("succeeded"), "finished");
{
  const db = new Database(":memory:");
  ensureExecutionRunTable(db);
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO cards (id) VALUES ('c1')").run();
  db.prepare(
    "INSERT INTO execution_runs (id, card_id, project_id, recipe_id, stage, source_hash,"
    + " source_text, args_text, adapter, workspace_id, artifact_root, origin_thread_id,"
    + " normalized_status, started_at, created_at) VALUES ('run_1', 'c1', 'p1', 'scope-map',"
    + " 'shape', 'h', 'text', '{}', 'native', 'ws', '/tmp/root', 'thr_1', 'running', 1000, 1000)",
  ).run();
  const stamped = markExecutionNeedsInputSent(db, "run_1", 4242);
  assert.equal(stamped.needsInputSentAt, 4242);
  assert.equal(getExecutionRun(db, "run_1").needsInputSentAt, 4242);
  db.close();
}

// --- native run updates never move the card ---
assert.deepEqual(runUpdates("hello"), { activity: "running", last_assistant_text: "hello", last_idle_at: null });

// --- transition facts + inbox keys are pure string maps ---
assert.deepEqual(declaredStages({ shape: {}, critique: {} }), ["shape", "critique"]);
assert.equal(questionInboxDedupeKey("c1", "q9"), "question:c1:q9");
assert.deepEqual(questionSyncKeys(new Database(":memory:"), "c1", ["live-1", "live-1", "live-2"]), ["question:c1:live-1", "question:c1:live-2"]);
assert.equal(errorInboxKeyPrefix("c1"), "error:c1");

// --- merge locks: second acquire loses until release ---
{
  const first = acquireScopeMergeLock("batch_seam_1");
  assert.ok(first && typeof first.release === "function");
  assert.equal(isScopeMergeLocked("batch_seam_1"), true);
  assert.equal(acquireScopeMergeLock("batch_seam_1"), null);
  releaseScopeMergeLock("batch_seam_1");
  assert.equal(isScopeMergeLocked("batch_seam_1"), false);
}

// --- shape version reads the frontmatter line, nothing else ---
assert.equal(readShapeVersion("---\nshape_version: 3\n---\nbody"), "3");
assert.equal(readShapeVersion("no frontmatter here"), null);
assert.equal(readShapeVersion(null), null);

// --- cancel/retry ledgers create their tables idempotently ---
{
  const db = new Database(":memory:");
  ensureScopeBatchCancelTables(db);
  ensureScopeBatchCancelTables(db);
  ensureScopeRetryTables(db);
  ensureScopeRetryTables(db);
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
  );
  assert.ok(tables.has("scope_batch_cancel_ledger"));
  assert.ok(tables.has("scope_retry_ledger"));
  db.close();
}

// --- panel routing: track paths resolve without a live panel ---
assert.equal(trackTitle("build"), "Build");
assert.equal(trackRootSubPath("research"), "research");
assert.equal(trackOfCard({ kind: "explore" }), "explore");
assert.equal(trackOfCard({ kind: "build" }), "build");
assert.equal(cardSubPath({ kind: "build" }, "card_1"), "build/card/card_1");
assert.equal(cardSubPath({ kind: "build" }, "card_1", "evt_2"), "build/card/card_1/event/evt_2");
assert.equal(inboxCardSubPath("card_1", "evt_2"), "inbox/card/card_1/event/evt_2");
assert.deepEqual(parseStelowSubPath(""), { kind: "track", track: "build" });
assert.deepEqual(parseStelowSubPath("inbox"), { kind: "track", track: "inbox" });
assert.deepEqual(
  parseStelowSubPath("build/card/card_abc"),
  { kind: "card", cardId: "card_abc", eventId: null, executionRunId: null, origin: "build" },
);
rememberStelowReturnFocusCardId("card_7");
assert.equal(consumeStelowReturnFocusCardId("card_8"), false);
assert.equal(consumeStelowReturnFocusCardId("card_7"), true);
assert.equal(consumeStelowReturnFocusCardId("card_7"), false);
assert.deepEqual(
  parseExecutionRunSubPath("build/card/card_abc/run/exec_1"),
  { track: "build", cardId: "card_abc", eventId: null, localRunId: "exec_1" },
);
assert.equal(parseExecutionRunSubPath("not-a-run"), null);

console.log("seam-coverage-expansion: ok");
