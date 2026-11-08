import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureColumns } from "../lib/sqlite-columns.mjs";
import { renderContrastArtifact } from "../lib/contrast-artifact.mjs";
import {
  consumeAnsweredContract,
  consumeAskContract,
  questionPremises,
  recordAskContracts,
  recordContrastAsks,
  recordDerivedQuestions,
} from "../lib/question-contracts.mjs";
import {
  observeFromCard,
  premiseVerdict,
  stalenessOfAnswered,
  staleTrailLine,
} from "../lib/premise-staleness.mjs";

// The creation path for a DERIVED question, and the rewind that invalidates an
// answer to it. Everything here runs against a real SQLite database and a real
// state dir on disk, because the claims are about stored rows and a matrix file
// that changed — a stub of either would prove nothing about the card.

function controlMatrix() {
  return {
    places: [
      { id: "cart", affordances: ["resume", "edit", "clear"] },
      { id: "checkout", affordances: ["request-refund"] },
    ],
    states: ["paid", "refunded"],
    cells: {
      "cart|paid": ["edit"],
      "cart|refunded": ["clear"],
      "checkout|paid": ["request-refund"],
      "checkout|refunded": ["request-refund"],
    },
  };
}

// The table as it shipped BEFORE this change: no premise, no reversal_cost. The
// migration runs over it exactly as a real install does, which is what makes
// "an older row still loads" a fact about the migration rather than about the
// fixture.
function legacyDatabase() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE ask_contracts (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    asked_at INTEGER NOT NULL,
    consumed_at INTEGER
  )`);
  ensureColumns(db, "ask_contracts", [["premise", "TEXT"], ["reversal_cost", "TEXT"]]);
  return db;
}

const db = legacyDatabase();
const stateDir = mkdtempSync(join(tmpdir(), "contrast-asks-"));

// --- 1. Additive migration: a row written before the premise still loads -----
// The legacy writer never knew the column; the migrated reader must not lose it.
assert.equal(
  recordAskContracts(db, [{ id: "legacy", cardId: "card_1", question: "Which scope?", contractId: "scope-adjustment-confirmed", askedAt: 100 }]),
  1,
  "a legacy declaration still records against the migrated table",
);
const legacyRow = questionPremises(db, "card_1").find((row) => row.id === "legacy");
assert.equal(legacyRow.premise, null, "a row written before the premise has no premise, and still loads");
assert.equal(legacyRow.reversalCost, null, "nor a reversal cost, and still loads");
assert.equal(
  consumeAskContract(db, "card_1", "Which scope?"),
  "scope-adjustment-confirmed",
  "the legacy row still consumes through the old entry point",
);
// A legacy answer has no ground to lose, so no verdict — never a false stale.
assert.deepEqual(
  stalenessOfAnswered([legacyRow], () => false).map((row) => row.verdict),
  [null],
  "an answer with no premise is never stale",
);

// --- 2. No premise, no question --------------------------------------------
// Three refusals, each naming the field it wants, and nothing written: half a
// derived ask is the half a reader finds later.
const controlArtifact = renderContrastArtifact(controlMatrix());
const blankCellArtifact = controlArtifact.replace(/"cart\|paid": \[\s*"edit"\s*\]/, '"cart|paid": []');

const countRows = () => db.prepare("SELECT COUNT(*) AS n FROM ask_contracts").get().n;
const before = countRows();

assert.throws(
  () => recordDerivedQuestions(db, [{
    id: "d1", cardId: "card_1", question: "cart offers nothing in paid?", askedAt: 200,
    reversalCost: { level: "low", why: "nothing runs on a blank cell." },
  }]),
  /derived question "d1" has no premise/,
  "a derived question without a premise is refused, naming the missing field",
);
assert.throws(
  () => recordDerivedQuestions(db, [{
    id: "d2", cardId: "card_1", question: "cart offers nothing in paid?", askedAt: 200,
    premise: "cart", reversalCost: { level: "low", why: "nothing runs on a blank cell." },
  }]),
  /has an unreadable premise/,
  "a premise that is not a cell or artifact reference is refused instead of stored",
);
assert.throws(
  () => recordDerivedQuestions(db, [{
    id: "d3", cardId: "card_1", question: "cart offers nothing in paid?", askedAt: 200, premise: "cart|paid",
  }]),
  /has no reversal_cost/,
  "a derived question without its reversal cost is refused, naming reversal_cost",
);
assert.equal(countRows(), before, "refused derived questions write nothing");

// All-or-nothing: a good row and a bad row in one batch land zero rows.
assert.throws(
  () => recordDerivedQuestions(db, [
    {
      id: "ok",
      cardId: "card_1",
      question: "cart offers nothing in paid?",
      askedAt: 200,
      premise: "cart|paid",
      reversalCost: { level: "low", why: "nothing runs on a blank cell." },
    },
    { id: "bad", cardId: "card_1", question: "checkout offers nothing?", askedAt: 200, premise: "checkout|paid" },
  ]),
  /derived question "bad" has no reversal_cost/,
  "a batch validates before it writes",
);
assert.equal(countRows(), before, "the valid half of a refused batch did not land");

// --- 3. A card asks a derived question, premise naming the blank cell --------
// The matrix is written where the scope stage writes it, in the card's state
// dir, and the artifact is what the creation path reads.
writeFileSync(join(stateDir, "contrast-matrix.md"), blankCellArtifact);
const askRows = [];
const result = recordContrastAsks(db, {
  cardId: "card_1",
  artifact: blankCellArtifact,
  askedAt: 300,
  makeId: () => `askc_${askRows.push(1)}`,
  contractId: "",
});
assert.deepEqual(result, { declarations: 1, recorded: 1 }, "one blank cell records one derived question");
const derived = questionPremises(db, "card_1").filter((row) => row.id.startsWith("askc_"));
assert.equal(derived.length, 1, "exactly one derived row landed");
assert.equal(derived[0].premise, "cart|paid", "the recorded question's premise names the blank cell");
assert.equal(derived[0].reversalCost.level, "low", "the recorded question carries its reversal cost level");
assert.match(derived[0].reversalCost.why, /blank cell/, "and the one sentence saying why");
assert.match(derived[0].question, /cart offers nothing in state paid/, "the question is what the model derived, not a re-phrasing");
assert.equal(derived[0].contractId, "", "a derived question answers no checklist contract");

// The complete matrix asks nothing, so running the creation path over it is a
// no-op rather than a repeat ask.
const complete = recordContrastAsks(db, { cardId: "card_1", artifact: controlArtifact, askedAt: 301, makeId: () => "unused" });
assert.deepEqual(complete, { declarations: 0, recorded: 0 }, "a complete matrix records no question");

// --- 4. Rewind invalidates by premise ---------------------------------------
// Two derived questions, two premises. The observation is the card's own state
// dir, so "a rewind" is a rewrite of the matrix file, not a flag.
writeFileSync(join(stateDir, "contrast-matrix.md"), blankCellArtifact);
const observe = observeFromCard({ stateDir });

// An artifact-line premise too: a decision must be able to rest on a document.
assert.equal(premiseVerdict("artifact:plans/spec-tech.md:3", () => true).stale, false, "an artifact line that still exists is not stale");
assert.deepEqual(
  premiseVerdict("artifact:plans/spec-tech.md:3", () => false),
  { stale: true, missing: ["artifact:plans/spec-tech.md:3"], checked: 1 },
  "an artifact line the file no longer has is stale, and the verdict names it",
);

const staleRowQuestion = derived[0].question;
const fresh = consumeAnsweredContract(db, "card_1", staleRowQuestion, { consumedAt: 400, observe });
assert.equal(fresh.verdict.stale, false, "before the rewind the premise still exists");
assert.equal(fresh.premise, "cart|paid", "the verdict is derived from the stored premise");
const answered = questionPremises(db, "card_1").find((row) => row.id === derived[0].id);
assert.equal(answered.consumedAt, 400, "a live premise consumes the declaration: this answer is an answer");

// The rewind: `paid` disappears from the matrix, which takes the cell (and its
// question's ground) with it. Nothing sets a flag; the file changed.
const rewound = controlMatrix();
rewound.cells = { "cart|refunded": ["clear"], "checkout|refunded": ["request-refund"] };
rewound.states = ["refunded"];
writeFileSync(join(stateDir, "contrast-matrix.md"), renderContrastArtifact(rewound));
const observeAfter = observeFromCard({ stateDir });

assert.deepEqual(
  premiseVerdict("cart|paid", observeAfter),
  { stale: true, missing: ["cart|paid"], checked: 1 },
  "a cell the rewound matrix no longer declares reads stale",
);
assert.equal(premiseVerdict("cart|refunded", observeAfter).stale, false, "a cell that survives the rewind does not");

// A second derived question, still unanswered, answered AFTER the rewind: its
// premise is gone, so it is not an answer and its declaration is not consumed.
recordDerivedQuestions(db, [{
  id: "askc_after",
  cardId: "card_1",
  question: "cart offers nothing in paid — a missing feature, or deliberately absent?",
  askedAt: 500,
  premise: "cart|paid",
  reversalCost: { level: "low", why: "a blank cell runs no code today." },
}]);
const staleAnswer = consumeAnsweredContract(
  db,
  "card_1",
  "cart offers nothing in paid — a missing feature, or deliberately absent?",
  { consumedAt: 600, observe: observeAfter },
);
assert.equal(staleAnswer.verdict.stale, true, "an answer whose premise the rewind removed reads stale");
assert.deepEqual(staleAnswer.verdict.missing, ["cart|paid"], "the verdict names the cell that is gone");
assert.equal(staleAnswer.contract, null, "a stale answer claims no contract");
const stillOpen = questionPremises(db, "card_1").find((row) => row.id === "askc_after");
assert.equal(stillOpen.consumedAt, null, "and its declaration stays unconsumed: a killed premise cannot satisfy a contract");
assert.match(staleTrailLine(staleAnswer.verdict) ?? "", /premise no longer exists \(cart\|paid\)/, "the trail names the missing premise, not just 'stale'");
assert.equal(staleTrailLine(fresh.verdict), null, "a surviving premise leaves no stale note");

// --- 5. An unreadable artifact is unknown, not stale ------------------------
// A card mid-rewrite (no artifact yet, or an unreadable one) must not have every
// decision called stale by an error. No observation means no verdict.
const noArtifactDir = mkdtempSync(join(tmpdir(), "contrast-asks-empty-"));
assert.equal(
  premiseVerdict("cart|paid", observeFromCard({ stateDir: noArtifactDir })),
  null,
  "no matrix artifact means no verdict for a cell premise",
);
assert.equal(premiseVerdict("cart|paid", null), null, "no observation at all means no verdict");
assert.deepEqual(
  stalenessOfAnswered([{ premise: "cart|paid" }], observeFromCard({ stateDir: noArtifactDir })).map((row) => row.verdict),
  [null],
  "an unobservable premise never reads stale",
);

rmSync(stateDir, { recursive: true, force: true });
rmSync(noArtifactDir, { recursive: true, force: true });
db.close();
console.log("contrast asks test ok: derived creation refuses a missing premise, rewind invalidates by premise");
