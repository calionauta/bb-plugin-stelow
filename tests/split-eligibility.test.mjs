import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  SPLIT_NON_BUILD_ERROR,
  SPLIT_STAGES,
  STANDARD_SPLIT_DISCLOSURE,
  matchSplitDecision,
  recordSplitAnswer,
  splitActionState,
  splitEligibility,
  splitStageError,
  withStandardSplitDisclosure,
} from "../lib/split-proposal.mjs";

// Single-source split gate: every entry point (worker ask validation,
// `split` executor, human trigger, card UI flag) decides through these
// helpers — never a pasted stage pair or error string.
assert.deepEqual(SPLIT_STAGES, ["triage", "select"], "the split point is one const, not folklore");

assert.deepEqual(splitEligibility({ kind: "build", stage: "triage" }), { ok: true, error: null }, "build at triage may split");
assert.deepEqual(splitEligibility({ kind: "build", stage: "select" }), { ok: true, error: null }, "build at select may split");
assert.equal(splitEligibility({ kind: "research", stage: "triage" }).error, SPLIT_NON_BUILD_ERROR, "research never splits, with the shared reason");
assert.equal(splitEligibility({ kind: "explore", stage: "select" }).error, SPLIT_NON_BUILD_ERROR, "explore never splits, with the shared reason");
assert.match(splitEligibility({ kind: "build", stage: "setup" }).error, /past the split point/, "past triage the gate refuses with its redirect");
assert.equal(splitEligibility({ kind: "build", stage: "setup" }).error, splitStageError("setup"), "the refusal text lives in one function");
assert.match(splitStageError(null), /unknown stage/, "an unresolvable stage refuses instead of crashing");

// Trigger/UI state: visibility is data (dumb UI), executability carries
// the reason. One function feeds both the RPC and the card flag.
const base = { kind: "build", stage: "triage", status: "draft", archived: false, openProposal: false, openQuestions: 0 };
assert.deepEqual(splitActionState(base), { show: true, ok: true, reason: null }, "a fresh triage build offers the trigger");
assert.equal(splitActionState({ ...base, openProposal: true }).ok, false, "an open proposal blocks a second one");
assert.match(splitActionState({ ...base, openProposal: true }).reason, /already open/, "the block names the pending proposal");
assert.equal(splitActionState({ ...base, openQuestions: 2 }).ok, false, "a pending question blocks the trigger");
assert.match(splitActionState({ ...base, openQuestions: 2 }).reason, /already pending/, "the block names the pending question");
assert.equal(splitActionState({ ...base, stage: "setup" }).show, false, "past the split point the UI hides, not disables");
assert.equal(splitActionState({ ...base, kind: "research" }).show, false, "research cards never show the trigger");
assert.equal(splitActionState({ ...base, status: "completed" }).show, false, "done cards never show the trigger");
assert.equal(splitActionState({ ...base, archived: true }).show, false, "archived cards never show the trigger");

// Answer matching: only the proposal's own question text lands in the row.
const decisions = [
  { question: "Split into cards?", answers: ["Alpha", "Beta"] },
  { question: "Which preset?", answers: ["fast"] },
];
assert.deepEqual(matchSplitDecision("Split into cards?", decisions), ["Alpha", "Beta"], "the proposal question records its answers");
assert.deepEqual(matchSplitDecision("Other question?", decisions), [], "answers to other questions never touch the split row");
assert.deepEqual(matchSplitDecision("", decisions), [], "a missing proposal matches nothing");
assert.deepEqual(matchSplitDecision("  Split into cards?  ", decisions), ["Alpha", "Beta"], "matching trims, like the host stores");

// Durable recording against a real database: live and expired paths share
// this helper, so both land identically or not at all.
const db = new Database(":memory:");
db.exec("CREATE TABLE split_proposals (card_id TEXT PRIMARY KEY, question TEXT, slices TEXT, selected TEXT, asked_at INTEGER, answered_at INTEGER, consumed_at INTEGER, created TEXT)");
db.prepare("INSERT INTO split_proposals VALUES (?, ?, ?, NULL, ?, NULL, NULL, '[]')").run("card_1", "Split into cards?", "[]", Date.now());
assert.equal(recordSplitAnswer(db, "card_1", decisions), 2, "the shared helper records both picks");
assert.deepEqual(JSON.parse(db.prepare("SELECT selected FROM split_proposals WHERE card_id = ?").get("card_1").selected), ["Alpha", "Beta"], "the row holds exactly the picked labels");
assert.equal(recordSplitAnswer(db, "card_1", decisions), 0, "a second recording matches nothing once selected is set");
assert.equal(recordSplitAnswer(db, "card_missing", decisions), 0, "a card without proposal records nothing");

// Consequence disclosure: a standard scope question at the split point
// must state it creates no cards, whatever the worker wrote.
assert.match(STANDARD_SPLIT_DISCLOSURE, /creates no new cards/, "the disclosure names the consequence");
assert.match(STANDARD_SPLIT_DISCLOSURE, /Propose split/, "the disclosure names the exit");
const disclosed = withStandardSplitDisclosure("Which files are in scope?");
assert.match(disclosed, /Which files are in scope\?/, "the worker text is preserved verbatim");
assert.ok(disclosed.endsWith(STANDARD_SPLIT_DISCLOSURE), "the disclosure is appended once");
assert.equal(withStandardSplitDisclosure(disclosed), disclosed, "re-enrichment is idempotent");
assert.equal(withStandardSplitDisclosure("  "), STANDARD_SPLIT_DISCLOSURE, "an empty question degrades to the disclosure alone");

console.log("split eligibility test ok: one gate, shared recording, dumb-UI state");
