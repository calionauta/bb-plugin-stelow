import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { MAX_AUTO_CONTINUES, MAX_DONE_NUDGES, ensureAutoContinueColumns, lastTurnAdvancedStages, nextAutoContinue, resetAutoContinue, shouldAutoContinue, shouldDoneNudge } from "../lib/auto-continue.mjs";

// Regression: a build worker narrated progress ("Stage done, moving on")
// and idled after every stage — the provider ends a turn on any final
// text — so each stage cost one human Resume. The host now resumes the
// worker itself while the finished turn left fresh progress behind.

const base = { status: "idle", stage: "shape", questionPending: false, transitioningIntoIdle: true, progressed: true, autoCount: 0, autoStage: null };
assert.equal(shouldAutoContinue(base).proceed, true, "idle worker with fresh progress is resumed");

assert.equal(shouldAutoContinue({ ...base, status: "active" }).proceed, false, "a running thread is never nudged");
assert.equal(shouldAutoContinue({ ...base, questionPending: true }).proceed, false, "a pending question blocks auto-continue (the answer arrives on its own)");
assert.equal(shouldAutoContinue({ ...base, stage: "audit" }).proceed, false, "the terminal stage is never resumed");
assert.equal(shouldAutoContinue({ ...base, transitioningIntoIdle: false }).proceed, false, "only a fresh idle edge resumes (no per-poll loops)");
assert.equal(shouldAutoContinue({ ...base, progressed: false }).proceed, false, "a silent stop stays paused (stuck, not chatty)");

// Budget: consecutive nudges without a stage advance stop at the cap, then
// the card falls through to the human-visible paused path.
assert.equal(MAX_AUTO_CONTINUES >= 1, true, "the budget is a positive cap");
assert.equal(shouldAutoContinue({ ...base, autoCount: MAX_AUTO_CONTINUES, autoStage: "shape" }).proceed, false, "an exhausted budget stays paused");
assert.equal(shouldAutoContinue({ ...base, autoCount: MAX_AUTO_CONTINUES, autoStage: "context" }).proceed, true, "advancing the stage resets the budget");
assert.equal(shouldAutoContinue({ ...base, autoCount: MAX_AUTO_CONTINUES - 1, autoStage: "shape" }).proceed, true, "the last budget unit still resumes");

assert.deepEqual(nextAutoContinue({ stage: "shape", autoCount: 2, autoStage: "shape" }), { count: 3, stage: "shape" }, "same-stage nudges accumulate");
assert.deepEqual(nextAutoContinue({ stage: "shape", autoCount: 9, autoStage: "context" }), { count: 1, stage: "shape" }, "a new stage restarts the count");
assert.deepEqual(nextAutoContinue({ stage: "shape", autoCount: 0, autoStage: null }), { count: 1, stage: "shape" }, "the first nudge counts one");
assert.deepEqual(resetAutoContinue(), { count: 0, stage: null }, "manual resume/restart wipes the budget");

// Done-nudge: reaching audit is not completing (the old audit+idle ⇒
// completed inference is gone — it made narrate-and-stop indistinguishable
// from done). The host resumes the worker with the done instruction, at
// most MAX_DONE_NUDGES times; past that the card pauses with the
// instruction visible.
const auditIdle = { status: "idle", questionPending: false, transitioningIntoIdle: true, autoCount: 0, autoStage: null };
assert.equal(shouldDoneNudge(auditIdle).proceed, true, "an audit-idle worker is resumed with the done instruction");
assert.equal(shouldDoneNudge({ ...auditIdle, cardStatus: "completed" }).proceed, false, "a completed card never receives an audit watchdog nudge");
assert.equal(shouldDoneNudge({ ...auditIdle, status: "active" }).proceed, false, "a running thread is never done-nudged");
assert.equal(shouldDoneNudge({ ...auditIdle, questionPending: true }).proceed, false, "a pending question blocks the done-nudge");
assert.equal(shouldDoneNudge({ ...auditIdle, transitioningIntoIdle: false }).proceed, false, "only a fresh idle edge nudges");
assert.equal(shouldDoneNudge({ ...auditIdle, autoCount: MAX_DONE_NUDGES, autoStage: "audit" }).proceed, false, "an exhausted done budget pauses instead");
assert.equal(shouldDoneNudge({ ...auditIdle, autoCount: MAX_DONE_NUDGES, autoStage: "shape" }).proceed, true, "leaving audit resets the done budget");
assert.equal(MAX_DONE_NUDGES >= 1, true, "the done budget is a positive cap");

// Migration: an existing cards table without the columns gains them safely
// and reruns are no-ops.
const db = new Database(":memory:");
db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, stage TEXT NOT NULL)");
ensureAutoContinueColumns(db);
const columns = db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name);
assert.ok(columns.includes("auto_continue_count"), "the count column is added");
assert.ok(columns.includes("auto_continue_stage"), "the stage column is added");
ensureAutoContinueColumns(db);
db.prepare("INSERT INTO cards VALUES (?, ?, 0, NULL)").run("card_1", "shape");
assert.equal(db.prepare("SELECT auto_continue_count FROM cards WHERE id = ?").get("card_1").auto_continue_count, 0, "old rows default to zero budget used");
db.close();

// A tool-only turn still moves the machine: a completed `bb stelow
// advance` inside the finished turn counts as progress even when the chat
// text is unchanged. The window is the last turn only — an older advance,
// a failed/pending one, a `--dry-run` validation, or a user-stopped thread
// whose final partial turn advanced nothing earns no resume.
const advanceItem = (command, status = "completed") => ({ type: "item/completed", data: { item: { type: "commandExecution", command, status } } });
const lastTurn = [
  { type: "thread/tokenUsage/updated", data: {} },
  { type: "turn/completed", data: { status: "completed" } },
];
assert.equal(lastTurnAdvancedStages([
  ...lastTurn,
  advanceItem("bb stelow status; bb stelow advance shape"),
  { type: "turn/started", data: {} },
  advanceItem("bb stelow advance triage"),
  { type: "turn/completed", data: { status: "completed" } },
]), true, "an advance in the finished turn resumes a silent worker");
assert.equal(lastTurnAdvancedStages([
  ...lastTurn,
  { type: "item/completed", data: { item: { type: "agentMessage", text: "hi" } } },
  { type: "turn/started", data: {} },
  advanceItem("bb stelow advance triage"),
  { type: "turn/completed", data: { status: "completed" } },
]), false, "an advance two turns back earns nothing");
assert.equal(lastTurnAdvancedStages([
  ...lastTurn,
  advanceItem("bb stelow advance shape", "failed"),
  { type: "turn/started", data: {} },
]), false, "a failed advance is not progress");
assert.equal(lastTurnAdvancedStages([
  ...lastTurn,
  advanceItem("bb stelow advance shape --dry-run"),
  { type: "turn/started", data: {} },
]), false, "a dry-run validation advances nothing");
assert.equal(lastTurnAdvancedStages([
  ...lastTurn,
  advanceItem("bb stelow advance --help"),
  { type: "turn/started", data: {} },
]), false, "a help probe advances nothing");
assert.equal(lastTurnAdvancedStages([
  ...lastTurn,
  advanceItem("bb stelow advance --stage shape"),
  { type: "turn/started", data: {} },
]), true, "the --stage form counts as an advance");
assert.equal(lastTurnAdvancedStages([
  ...lastTurn,
  { type: "item/completed", data: JSON.stringify({ item: { type: "commandExecution", command: "bb stelow advance shape", status: "completed" } }) },
  { type: "turn/started", data: {} },
]), true, "string-encoded event data is tolerated");
assert.equal(lastTurnAdvancedStages("nope"), false, "non-array history reads as no advance");
assert.equal(lastTurnAdvancedStages([{ type: "turn/completed", data: {} }, null, { nope: 1 }]), false, "odd shapes never throw, they just miss");
assert.equal(lastTurnAdvancedStages([]), false, "empty history advances nothing");

// Server contract: the idle branch consults the guard and resumes through
// the shared continue copy; manual recovery paths reset the budget.
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/plugin-runtime.ts"), "utf8");
const coreMigrations = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/core-migrations.ts"), "utf8");
assert.match(serverSource, /shouldAutoContinue\(\{/, "the idle branch consults the auto-continue guard");
assert.match(serverSource, /cardStatus: card\.status/, "the audit watchdog receives the persisted card completion state");
assert.match(
  serverSource,
  /bb\.sdk\.threads\s*\n?\s*\.send\(\{[\s\S]*?threadId: card\.worker_thread_id,[\s\S]*?mode: "auto",[\s\S]*?input: \[[\s\S]*?text: buildContinueNudge\(\),[\s\S]*?mentions: \[\],[\s\S]*?visibility: "agent-only"/,
  "auto-continue sends the shared continue nudge privately in place",
);
assert.match(
  serverSource,
  /auto_continue_count:\s*autoNext\.count,\s*auto_continue_stage:\s*autoNext\.stage/,
  "a resume records its budget use",
);
assert.match(serverSource, /function buildContinueNudge\(\): string/, "manual Retry and auto-continue share one nudge");
assert.match(
  serverSource,
  /a visible structured form on the card counts as a pending question/,
  "the recovery nudge cannot wait on an invisible question",
);
assert.match(serverSource, /decideAskGate\(\{/, "the ask handler decides through the shared dispatcher");
assert.match(serverSource, /liveCount: liveAsks\.length,/, "the dispatcher receives the live interaction count");
assert.match(serverSource, /expiredCount: openExpiredQuestionIds\(cardRow\.id\)\.length,/, "the dispatcher receives the recoverable expired count");
const resets = serverSource.match(/resetAutoContinue\(\)/g) ?? [];
assert.ok(resets.length >= 2, `manual retry/restart reset the budget, found ${resets.length} reset sites`);
assert.match(serverSource, /Turn discipline: never end a turn with a bare progress report/, "the spawn prompt teaches turn discipline");
assert.match(coreMigrations, /ensureAutoContinueColumns\(db\)/, "the migration composition ensures the budget columns");
assert.match(serverSource, /lastTurnAdvancedStages\(recent\)/, "a silent stop scans the finished turn for an advance");
assert.match(
  serverSource,
  /threads\.events\.list\(\{[\s\S]*?threadId: card\.worker_thread_id,[\s\S]*?order: "desc",[\s\S]*?limit: "100",[\s\S]*?types: \["turn\/completed", "turn\/started", "item\/completed"\]/,
  "the scan reads turn boundaries and completions only",
);

console.log("auto-continue test ok: decision matrix, budget, migration, advance scan, shared nudge, prompt discipline");
