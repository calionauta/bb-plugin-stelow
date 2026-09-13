import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { MAX_AUTO_CONTINUES, ensureAutoContinueColumns, nextAutoContinue, resetAutoContinue, shouldAutoContinue } from "../lib/auto-continue.mjs";

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

// Server contract: the idle branch consults the guard and resumes through
// the shared continue copy; manual recovery paths reset the budget.
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.ts"), "utf8");
assert.match(serverSource, /shouldAutoContinue\(\{/, "the idle branch consults the auto-continue guard");
assert.match(serverSource, /bb\.sdk\.threads\.send\(\{ threadId: card\.worker_thread_id, mode: "auto", input: \[\{ type: "text", text: buildContinueNudge\(\), mentions: \[\] \}\] \}\)/, "auto-continue sends the shared continue nudge in place");
assert.match(serverSource, /auto_continue_count: autoNext\.count, auto_continue_stage: autoNext\.stage/, "a resume records its budget use");
assert.match(serverSource, /function buildContinueNudge\(\): string/, "manual Retry and auto-continue share one nudge");
const resets = serverSource.match(/resetAutoContinue\(\)/g) ?? [];
assert.ok(resets.length >= 2, `manual retry/restart reset the budget, found ${resets.length} reset sites`);
assert.match(serverSource, /Turn discipline: never end a turn with a bare progress report/, "the spawn prompt teaches turn discipline");
assert.match(serverSource, /ensureAutoContinueColumns\(db\)/, "the migration ensures the budget columns");

console.log("auto-continue test ok: decision matrix, budget, migration, shared nudge, prompt discipline");
