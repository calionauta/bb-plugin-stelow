import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { consumeAskContract, normalizeQuestionText, recordAskContracts, validateAskContracts } from "../lib/ask-contracts.mjs";

// Normalization is shared by writers and matchers: cosmetic whitespace
// differences never break the link.
assert.equal(normalizeQuestionText("  Which interface?\n  Pick one. "), "Which interface? Pick one.", "trims and collapses");
assert.equal(normalizeQuestionText(null), "", "non-text normalizes empty");

// Validation: known human-ask passes, agent-receipt redirects, unknown
// refuses only against a readable checklist, unreadable fails open.
const checklist = [
  { id: "interface-pick", kind: "human-ask" },
  { id: "interface-pick-auto", kind: "agent-receipt" },
];
assert.deepEqual(validateAskContracts([], checklist), { ok: true, error: null }, "no declarations need nothing");
assert.deepEqual(
  validateAskContracts([{ contractId: "interface-pick" }], checklist).ok,
  true,
  "declared human-ask passes",
);
assert.match(
  validateAskContracts([{ contractId: "interface-pick-auto" }], checklist).error ?? "",
  /file receipt/,
  "agent-receipt ids redirect to the receipt",
);
assert.match(
  validateAskContracts([{ contractId: "nope" }], checklist).error ?? "",
  /Valid ids: interface-pick, interface-pick-auto/,
  "unknown ids refuse with the valid list",
);
assert.deepEqual(validateAskContracts([{ contractId: "nope" }], null).ok, true, "unreadable checklist records raw");
assert.deepEqual(validateAskContracts([{ contractId: "nope" }], []).ok, true, "empty checklist records raw");

// Record + consume against real SQLite: exact text match, consume-once,
// whitespace-insensitive, ordered oldest-first.
const db = new Database(":memory:");
db.exec(`CREATE TABLE ask_contracts (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  asked_at INTEGER NOT NULL,
  consumed_at INTEGER
)`);
assert.equal(
  recordAskContracts(db, [
    { id: "a1", cardId: "card_1", question: "Which interface?", contractId: "interface-pick", askedAt: 100 },
    { id: "a2", cardId: "card_1", question: "  Which interface?\n", contractId: "interface-pick", askedAt: 200 },
    { id: "bad", cardId: "card_1", question: "", contractId: "interface-pick", askedAt: 300 },
  ]),
  2,
  "blank questions are skipped",
);
assert.equal(consumeAskContract(db, "card_1", "Which interface?"), "interface-pick", "first answer consumes the oldest declaration");
assert.equal(consumeAskContract(db, "card_1", "Which  interface?"), "interface-pick", "whitespace variants still match");
assert.equal(consumeAskContract(db, "card_1", "Which interface?"), null, "consumed declarations never match twice");
assert.equal(consumeAskContract(db, "card_1", "Unrelated?"), null, "undeclared answers match nothing");
assert.equal(consumeAskContract(db, "card_2", "Which interface?"), null, "other cards never match");

db.close();
console.log("ask contracts test ok: declaration validation, text-matched consume-once linkage");
