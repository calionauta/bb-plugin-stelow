import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  MAX_AUTO_CONTINUES,
  MAX_DONE_NUDGES,
  ensureAutoContinueColumns,
  lastTurnAdvancedStages,
  lastTurnStelowCalls,
  nextAutoContinue,
  resetAutoContinue,
  shouldAutoContinue,
  shouldDoneNudge,
} from "../lib/auto-continue.mjs";
import {
  autoContinueFields,
  buildContinueInput,
  buildContinueNudge,
} from "../lib/worker-continuation.mjs";

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

// Continuation transport is private for automatic nudges and public for manual
// retries. The explicit public path is the negative control for private visibility.
const nudge = buildContinueNudge("Interface choice: use the selected form.");
assert.match(nudge, /Interface choice: use the selected form\./, "the continuation keeps interface guidance");
assert.match(nudge, /a prior chat message or split-proposal record does not/, "past messages are not pending questions");
assert.match(nudge, /host refuses duplicates when a real form is open/, "invisible questions cannot bypass duplicate asks");
assert.match(nudge, /Never claim to be waiting based on memory alone/, "memory cannot manufacture a wait");
const privateInput = buildContinueInput(nudge, "private");
const publicInput = buildContinueInput(nudge, "public");
assert.equal(privateInput[0].visibility, "agent-only", "automatic continuation is private");
assert.equal(publicInput[0].visibility, undefined, "manual continuation remains public");
assert.equal(privateInput[0].text, publicInput[0].text, "both paths share the same continuation copy");
assert.deepEqual(privateInput[0].mentions, [], "continuation input carries no mentions");

const recorded = autoContinueFields({ count: 2, stage: "shape" }, "fresh output");
assert.deepEqual(
  {
    activity: recorded.activity,
    idle: recorded.last_idle_at,
    error: recorded.last_error,
  },
  { activity: "running", idle: null, error: null },
  "a successful continuation returns the card to a healthy running state",
);
assert.equal(recorded.auto_continue_count, 2, "a successful continuation records its budget");
assert.equal(recorded.auto_continue_stage, "shape", "budget recording keeps the current stage");
assert.equal(recorded.last_assistant_text, "fresh output", "fresh output is recorded");
assert.equal(
  autoContinueFields({ count: 3, stage: "context" }, null).last_assistant_text,
  undefined,
  "unknown output does not blank the previous trail",
);

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

// The same window, read for what it says about `done` instead of `advance`.
// This is the signal the audit park is missing today: a worker that ran
// `bb stelow done` and had the gate refuse it is not waiting for an
// instruction, and the sentence it used to get named none of that.
//
// Every case below is one where the naive scan lies, so the whole point of the
// `done` predicate is that it is narrower than the event list it walks.
const doneItem = (command, status = "completed", exitCode) => ({
  type: "item/completed",
  data: { item: { type: "commandExecution", command, status, ...(exitCode === undefined ? {} : { exitCode }) } },
});
assert.deepEqual(
  lastTurnStelowCalls([...lastTurn, doneItem("bb stelow done", "failed", 1)]),
  { advanced: false, done: true, doneFailed: true },
  "a failed done is the refused gate, exit code or status alike",
);
assert.deepEqual(
  lastTurnStelowCalls([...lastTurn, doneItem("bb stelow done")]),
  { advanced: false, done: true, doneFailed: false },
  "a done that came back clean still means the card is not complete",
);
assert.deepEqual(
  lastTurnStelowCalls([...lastTurn, doneItem("bb stelow done", "completed", 0)]),
  { advanced: false, done: true, doneFailed: false },
  "an explicit zero exit is not a refusal",
);
// This is the shape a real refusal has: the command ran and the shell
// succeeded, so the item's own status is "completed", and the non-zero exit
// code is the CLI saying no. Reading only the item status would call every
// refused done a clean one — the opposite of the truth, and it would put the
// "the card is not complete" sentence on a card whose gate had a reason.
assert.deepEqual(
  lastTurnStelowCalls([...lastTurn, doneItem("bb stelow done", "completed", 1)]),
  { advanced: false, done: true, doneFailed: true },
  "a non-zero exit under a completed status is still the gate refusing",
);
assert.deepEqual(
  lastTurnStelowCalls([...lastTurn, doneItem("bb stelong done", "failed", 1)]),
  { advanced: false, done: false, doneFailed: false },
  "a typo'd verb never reached the gate, so it is not a gate refusal",
);
assert.deepEqual(
  lastTurnStelowCalls([...lastTurn, doneItem("bb stelow ask")]),
  { advanced: false, done: false, doneFailed: false },
  "asking is not completing",
);
assert.deepEqual(
  lastTurnStelowCalls([...lastTurn, advanceItem("bb stelow advance shape")]),
  { advanced: true, done: false, doneFailed: false },
  "an advance is still an advance through the shared window",
);
assert.deepEqual(
  lastTurnStelowCalls([...lastTurn, doneItem("bb stelow done --help"), doneItem("bb stelow done --dry-run")]),
  { advanced: false, done: false, doneFailed: false },
  "a probe is a probe: --help and --dry-run never reach the gate",
);
assert.deepEqual(
  lastTurnStelowCalls([
    ...lastTurn,
    { type: "item/completed", data: { item: { type: "agentMessage", text: "should I run done now?" } } },
  ]),
  { advanced: false, done: false, doneFailed: false },
  "a worker that merely asks about done in prose has run nothing",
);
assert.deepEqual(
  lastTurnStelowCalls([
    ...lastTurn,
    { type: "turn/started", data: {} },
    doneItem("bb stelow done", "failed", 1),
  ]),
  { advanced: false, done: false, doneFailed: false },
  "a done two turns back describes a park that already happened",
);
const stringDone = { type: "item/completed", data: JSON.stringify(doneItem("bb stelow done").data) };
assert.deepEqual(
  lastTurnStelowCalls([...lastTurn, stringDone, { type: "turn/started", data: {} }]),
  { advanced: false, done: true, doneFailed: false },
  "string-encoded event data is tolerated here too",
);
assert.deepEqual(lastTurnStelowCalls("nope"), { advanced: false, done: false, doneFailed: false }, "non-array history is don't-know");
assert.deepEqual(lastTurnStelowCalls([]), { advanced: false, done: false, doneFailed: false }, "empty history ran nothing");

// Server contract: the idle branch sends the shared nudge privately only after
// a successful send, while manual recovery sends the same transport publicly.
const operationsSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/card-operations.ts"), "utf8");
const syncDir = join(dirname(fileURLToPath(import.meta.url)), "../server/runtime");
// The idle policy and the terminal-stage park are two modules now: the done
// nudge reads the same persisted completion state the auto-continue guard does,
// so both belong in the corpus these pins read.
// The turn scan now lives in stelow-turn-verbs.ts, its own module beside the
// sentence it derives. It is in this corpus because these pins are about the
// scan itself: which events it reads, and that exactly one fetch happens.
const turnVerbsSource = readFileSync(join(syncDir, "stelow-turn-verbs.ts"), "utf8");
const threadSyncSource = [
  readFileSync(join(syncDir, "build-thread-sync.ts"), "utf8"),
  readFileSync(join(syncDir, "build-thread-terminal.ts"), "utf8"),
  turnVerbsSource,
].join("\n");
const cardCopySource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/card-copy.ts"), "utf8");
const protocolsSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/plugin-protocols.ts"), "utf8");
const coreMigrations = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/core-migrations.ts"), "utf8");
const askGateSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/cli/cli-ask-gate.ts"), "utf8");
const autoStart = threadSyncSource.indexOf("const input = buildContinueInput");
const autoEnd = threadSyncSource.indexOf("function persistStandardIdle", autoStart);
const autoBlock = threadSyncSource.slice(autoStart, autoEnd);
const retryStart = operationsSource.indexOf("async function retryWorker(");
const retryEnd = operationsSource.indexOf("function startWorker(", retryStart);
const retryBlock = operationsSource.slice(retryStart, retryEnd);
assert.match(threadSyncSource, /shouldAutoContinue\(\{/, "the idle branch consults the auto-continue guard");
assert.match(threadSyncSource, /cardStatus: snapshot\.card\.status/, "the audit watchdog receives persisted completion state");
assert.match(
  autoBlock,
  /const input = buildContinueInput\([\s\S]*?buildContinueNudge\(deps\.interfacePick\)[\s\S]*?"private"[\s\S]*?sendAgentInput/,
  "auto-continue sends the shared continue nudge privately in place",
);
const budgetAt = autoBlock.indexOf("const next = nextAutoContinue({");
const successOrder = [
  autoBlock.indexOf("const dispatch = await sendAgentInput"),
  autoBlock.indexOf('if (dispatch.delivery === "queued") {'),
  budgetAt,
  // Scoped past the budget so the queued branch's own `updateCard` (which is
  // what projects the hold) cannot be mistaken for the one that records it.
  autoBlock.indexOf("deps.updateCard(", budgetAt),
  autoBlock.indexOf("return true", budgetAt),
];
assert.ok(successOrder.every((position) => position >= 0), "successful auto-continue records through every step");
assert.deepEqual(successOrder, [...successOrder].sort((a, b) => a - b), "budget recording follows a successful send");
// The budget must sit BEHIND the queued branch, not merely after the send. On
// card_e3u00eb4 (2026-09-30) a dispatch the host held was recorded as a resume
// because `threads.send` does not throw when it queues, so ten held nudges
// spent the whole budget and the card parked itself as if a person were
// needed. Any reordering that lets the queued branch fall through to the
// budget write brings that back.
const queuedBranch = autoBlock.slice(autoBlock.indexOf('if (dispatch.delivery === "queued") {'));
assert.match(queuedBranch, /holdUpdates\(snapshot\.lastOutput\)/, "a queued dispatch projects the hold");
assert.doesNotMatch(
  queuedBranch.slice(0, queuedBranch.indexOf("const next = nextAutoContinue")),
  /nextAutoContinue|auto_continue_count/,
  "a dispatch the host held spends no auto-continue budget",
);
assert.match(autoBlock, /autoContinueFields\(next, snapshot\.lastOutput\)/, "the recovery budget uses shared fields");
assert.match(cardCopySource, /buildContinueNudge\(interfacePick\)/, "manual build Retry shares the extracted nudge");
assert.match(retryBlock, /deps\.buildContinueInput\(deps\.buildNudge\(card\), "public"\)/, "manual Retry stays public");
assert.doesNotMatch(retryBlock, /agent-only/, "manual Retry never inherits private visibility");
assert.match(askGateSource, /decideAskGate\(\{/, "the ask handler decides through the shared dispatcher");
assert.match(askGateSource, /liveCount: liveAsks\.length,/, "the dispatcher receives the live interaction count");
assert.match(askGateSource, /expiredCount: deps\.openExpiredQuestionIds\(cardId\)\.length,/, "the dispatcher receives the recoverable expired count");
const doneSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/cli/cli-done-track.ts"),
  "utf8",
);
const reseedSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/card-reseed.ts"), "utf8");
assert.match(operationsSource, /const reset = deps\.resetAutoContinue\(\)/, "manual retry resets the budget");
assert.match(reseedSource, /const reset = deps\.resetAutoContinue\(\)/, "reseed resets the budget");
assert.equal(
  (doneSource.match(/resetAutoContinue\(\)/g) ?? []).length,
  1,
  "every done track resets the budget through one shared completion writer",
);
assert.match(protocolsSource, /Turn discipline: never end a turn with a bare progress report/, "the spawn prompt teaches turn discipline");
assert.match(coreMigrations, /ensureAutoContinueColumns\(db\)/, "the migration composition ensures the budget columns");
assert.match(threadSyncSource, /lastTurnStelowCalls\(events\)/, "a silent stop scans the finished turn for the verbs it ran");
// The fetch moved out of `detectProgress` into one `readStelowCalls` shared by
// the advance scan and the terminal park, so the window is read once per idle
// sync. The options below are the whole point of the pin: narrowing the type
// list would silently drop the turn boundary the scan windows on.
const advanceEventPattern = new RegExp([
  String.raw`threads\.events\.list\(\{[\s\S]*?threadId,`,
  String.raw`[\s\S]*?order: "desc",[\s\S]*?limit: "100",`,
  String.raw`[\s\S]*?types: \["turn\/completed", "turn\/started", "item\/completed"\]`,
].join(""));
assert.match(
  threadSyncSource,
  advanceEventPattern,
  "the scan reads turn boundaries and completions only",
);
assert.equal(
  (threadSyncSource.match(/threads\.events\.list\(/g) ?? []).length,
  1,
  "one fetch per idle sync: two readers cannot see two different windows",
);

console.log("auto-continue test ok: decision matrix, budget, migration, advance and done scan, shared nudge, prompt discipline");
