import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { templateStages } from "../lib/state-template.mjs";
import { ownsWorkflowState, stateWorkflowId, upsertWorkflowEntry, workflowDirHash, workflowStateRelativeDir } from "../lib/workflow-state-identity.mjs";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";
import { LEGACY_REVIEW_MODE_TO_GATES } from "../lib/review-gates.mjs";
import { requiredForStage } from "../lib/question-contracts.mjs";
import { buildBoardColumnFor, stageLabel, stageSkill, STAGE_SEQUENCE } from "../lib/workflow-vocabulary.mjs";
import { statusForNewCardWork } from "../lib/card-work-resume.mjs";
import { resolveCardMove } from "../lib/card-move.mjs";
import { isClaimTerminal } from "../lib/card-terminal.mjs";
import { claimSpawnRetry, isRetryableSpawnError, resetSpawnRetry } from "../lib/spawn-retry.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => JSON.parse(readFileSync(join(root, `tests/fixtures/persisted-cards/${name}.json`), "utf8"));
const stateStage = (state) => state.match(/^current_stage:\s*(\S+)/m)?.[1];
const stateStages = (state) => [...state.matchAll(/^  ([a-z][a-z0-9-]*): pending$/gm)].map((match) => match[1]);
const stateOwner = (state) => stateWorkflowId(state);

// Cold install: the persisted card has no worker or state directory yet. The
// current template still gives it a complete canonical stage set, and a card
// id remains an immutable owner when its first state entry is written.
{
  const cold = fixture("cold-install");
  assert.equal(cold.tracking.workflows.length, 0, "cold install starts with no workflow entry");
  assert.equal(cold.card.workerThreadId, null, "cold install has no worker to recover");
  assert.equal(cold.card.dirHash, null, "cold install has no state directory");
  assert.deepEqual(templateStages(), STAGE_SEQUENCE, "the state template owns the canonical stage list");
  assert.deepEqual(stateStages(cold.state), templateStages(), "the cold state fixture contains every canonical stage");
  assert.equal(stateOwner(cold.state), cold.card.id, "the seeded state is owned by the card");
  assert.equal(ownsWorkflowState(cold.state, cold.card.id), true, "cold state ownership is resolvable");
  assert.equal(stateStage(cold.state), "triage", "cold state starts at triage");
  const entry = { workflowId: cold.card.id, name: "Cold install", dirHash: workflowDirHash(cold.card.id), created: "2026-09-23T00:00:00.000Z" };
  const tracking = upsertWorkflowEntry(cold.tracking.workflows, entry);
  assert.equal(workflowStateRelativeDir(entry), `.stelow/2026-09-23/${entry.dirHash}`, "the first state path is deterministic");
  assert.equal(workflowStateRelativeDir(tracking[0]), `.stelow/2026-09-23/${entry.dirHash}`, "the persisted entry resolves the same state path");
}

// Upgrade: old cards may carry only a legacy review_mode. Every legacy mode
// must resolve to the current gate set without changing the card's owner or
// checkpoint, and the old and new representations must have the same contracts.
{
  const upgrade = fixture("legacy-review-modes");
  assert.equal(stateOwner(upgrade.state), upgrade.card.id, "upgrade preserves immutable card ownership");
  assert.equal(stateStage(upgrade.state), upgrade.card.stage, "upgrade preserves the persisted checkpoint");
  for (const mode of upgrade.modes) {
    const state = upgrade.state.replace(/^  review_mode:.*$/m, `  review_mode: ${mode.label}`);
    const config = parseWorkflowConfig(state, { strict: true });
    assert.deepEqual(config.reviewGates, mode.gates, `${mode.label} migrates to its gate set`);
    assert.equal(config.reviewMode, mode.label, `${mode.label} remains readable as a legacy mode`);
    for (const stage of ["selection", "plan-gate", "diff-gate"]) {
      assert.deepEqual(
        requiredForStage({ stage, appetite: "Core", reviewMode: mode.label }),
        requiredForStage({ stage, appetite: "Core", reviewMode: mode.gates }),
        `${mode.label} keeps the same ${stage} contracts after upgrade`,
      );
    }
  }
  for (const [label, gates] of Object.entries(LEGACY_REVIEW_MODE_TO_GATES)) {
    assert.deepEqual(parseWorkflowConfig(upgrade.state.replace(/^  review_mode:.*$/m, `  review_mode: ${label}`), { strict: true }).reviewGates, gates, `${label} is covered by the persisted upgrade fixture`);
  }
}

// Reopen: a completed persisted card gets a new worker turn, but state.md
// remains the source of truth for its checkpoint.
{
  const reopened = fixture("reopen");
  const result = statusForNewCardWork(reopened.card);
  assert.deepEqual(result, { status: "in-progress", reopened: true }, "a completed card reopens for new work");
  assert.equal(reopened.card.stage, "audit", "reopen does not invent or reset a stage");
  assert.equal(stateStage(reopened.state), reopened.card.stage, "the state file still owns the old checkpoint");
  assert.equal(ownsWorkflowState(reopened.state, reopened.card.id), true, "reopen can still resolve its persisted state");
}

// Retry: start-phase recovery is persisted, bounded, and scoped to the same
// failed worker. A reseeded/new worker episode gets a fresh budget.
{
  const retry = fixture("retry");
  assert.equal(isRetryableSpawnError(retry.failure), true, "the persisted transient start failure is retryable");
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, spawn_retry_count INTEGER NOT NULL DEFAULT 0, spawn_retry_thread TEXT)");
  db.prepare("INSERT INTO cards (id, spawn_retry_count, spawn_retry_thread) VALUES (?, ?, ?)").run(retry.card.id, retry.card.spawnRetryCount, retry.card.spawnRetryThread);
  assert.equal(claimSpawnRetry(db, retry.card.id, retry.card.workerThreadId), 1, "the persisted failed worker claims retry one");
  assert.equal(claimSpawnRetry(db, retry.card.id, retry.card.workerThreadId), 2, "the same failed worker claims retry two");
  assert.equal(claimSpawnRetry(db, retry.card.id, retry.card.workerThreadId), 3, "the same failed worker claims the final retry");
  assert.equal(claimSpawnRetry(db, retry.card.id, retry.card.workerThreadId), 0, "the retry budget is exhausted");
  assert.equal(claimSpawnRetry(db, retry.card.id, "thr_new_worker"), 1, "a replacement worker starts a fresh retry episode");
  resetSpawnRetry(db, retry.card.id);
  assert.equal(claimSpawnRetry(db, retry.card.id, retry.card.workerThreadId), 1, "a successful worker reset restores the retry budget");
  db.close();
}

// Archive: the persisted card can move to the terminal archive state, which
// releases claims and makes the card's retained checkpoint non-actionable.
{
  const archive = fixture("archive");
  const decision = resolveCardMove(archive.card.kind, "archived");
  assert.deepEqual(decision, { ok: true, move: { type: "status", status: "archived" } }, "archive is a supported terminal move");
  const archived = { ...archive.card, status: "archived" };
  assert.equal(isClaimTerminal(archived.status), true, "archive releases card claims");
  assert.equal(buildBoardColumnFor(archived), "archived", "archived status wins over the retained stage");
  assert.equal(ownsWorkflowState(archive.state, archive.card.id), true, "archive leaves the owned state addressable for history");
}

// Delete: hard delete is only a second step after archive. Pin the server
// lifecycle guard and the owned-state cleanup because deletion crosses the
// host boundary and cannot be exercised by a pure helper.
{
  const deleteCase = fixture("delete");
  assert.equal(isClaimTerminal(deleteCase.card.status), true, "delete fixture is archived before deletion");
  const server = readFileSync(join(root, "server.ts"), "utf8");
  const deleteStart = server.indexOf("    async deleteCard({");
  const deleteEnd = server.indexOf("    async discardPreview({", deleteStart);
  assert.ok(deleteStart >= 0 && deleteEnd > deleteStart, "delete RPC exists");
  const deleteRpc = server.slice(deleteStart, deleteEnd);
  assert.match(deleteRpc, /if \(card\.status !== "archived"\) return \{ deleted: false, error: "Only archived cards can be deleted\./, "delete refuses an unarchived persisted card");
  assert.match(deleteRpc, /workflowStateDir\(bb, workspace\.path, card\.id, card\.dir_hash\)/, "delete removes only state owned by the card");
  assert.match(deleteRpc, /DELETE FROM cards WHERE id = \?/, "delete removes the persisted card row");
}

// Unknown old stage IDs: persisted cards must remain inspectable and safe.
// They fall back to the Analysis projection, expose their old label, and do
// not fabricate a transition contract or upstream skill.
{
  const unknown = fixture("unknown-old-stage");
  assert.equal(stateOwner(unknown.state), unknown.card.id, "unknown-stage state retains ownership");
  assert.equal(stateStage(unknown.state), unknown.card.stage, "unknown stage is not rewritten during upgrade");
  assert.equal(buildBoardColumnFor(unknown.card), "analysis", "unknown stage has a safe board projection");
  assert.equal(stageLabel(unknown.card.stage), "legacy-preflight", "unknown stage remains visible by its stored id");
  assert.equal(stageSkill(unknown.card.stage), null, "unknown stage never invents an upstream skill");
  assert.deepEqual(requiredForStage({ stage: unknown.card.stage, appetite: "Core", reviewMode: "Auto" }), [], "unknown stage has no fabricated contracts");
}

console.log("persisted-card migration test ok: cold install, legacy upgrade, reopen, retry, archive, delete, and unknown old stages");
