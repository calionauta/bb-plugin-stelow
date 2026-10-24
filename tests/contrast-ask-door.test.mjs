// The door between a matrix and the questions it implies, exercised against a
// real SQLite database and a real state dir. Every claim here is about a stored
// row or a file on disk; a stubbed pair would prove nothing about a card.
//
// The red proof for this file is in tests/card-detail-contrast.test.mjs: with
// the call removed from the card detail, a matrix with a blank cell records
// zero questions. This file proves the recording itself — one row, its premise,
// and that reading the same matrix twice does not ask twice.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderContrastArtifact } from "../lib/contrast-artifact.mjs";
import { recordMatrixQuestions } from "../lib/contrast-ask-door.mjs";
import { questionPremises } from "../lib/question-contracts.mjs";
import { ensureColumns } from "../lib/sqlite-columns.mjs";

function matrix(cells) {
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
      ...cells,
    },
  };
}

// A blank cell, spelled by taking its affordances away — the shape a matrix
// has when the scope worker has not decided that cell yet.
const oneBlank = matrix({});
delete oneBlank.cells["cart|paid"];

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

const stateDir = mkdtempSync(join(tmpdir(), "contrast-door-"));
const read = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
const rowsFor = (cardId) => questionPremises(db, cardId);
const barrier = () => {
  // `recordMatrixQuestions` hands `read` the artifact path; keeping the read
  // relative to this state dir is what makes "the matrix changed" a file write.
  const artifact = join(stateDir, "contrast-matrix.md");
  return artifact;
};

// 1. One blank cell, one question, and the premise names that cell.
writeFileSync(barrier(), renderContrastArtifact(oneBlank));
assert.deepEqual(
  await recordMatrixQuestions(db, {
    cardId: "card_blank",
    stateDir,
    askedAt: 10,
    makeId: (declaration, index) => `askc_${index}_${declaration.premise}`,
    read,
  }),
  { declarations: 1, recorded: 1 },
  "a matrix with one blank cell records exactly one question",
);
const [asked] = rowsFor("card_blank");
assert.equal(rowsFor("card_blank").length, 1, "exactly one derived row landed");
assert.equal(asked.premise, "cart|paid", "the recorded question's premise is the blank cell");
assert.match(asked.question, /cart offers nothing in state paid/, "the question is the model's, not a re-phrasing");
assert.equal(asked.consumedAt, null, "and it is OPEN: the answer door has not consumed it");
assert.equal(asked.contractId, "", "a derived question answers no checklist contract");

// 2. Reading the same matrix again asks nothing: the detail is opened many
//    times, and a question re-asked on every open is a wait nobody can end.
assert.deepEqual(
  await recordMatrixQuestions(db, { cardId: "card_blank", stateDir, askedAt: 11, makeId: () => "unused", read }),
  { declarations: 0, recorded: 0 },
  "a second read of the same matrix records no new question",
);
assert.equal(rowsFor("card_blank").length, 1, "and the card still has exactly one row");

// 3. A NEW hole is a new question: dedupe is per question, not "the first read
//    wins". A complete matrix asks nothing, then blanking a second cell asks.
writeFileSync(barrier(), renderContrastArtifact(matrix({})));
assert.deepEqual(
  await recordMatrixQuestions(db, { cardId: "card_blank", stateDir, askedAt: 12, makeId: () => "unused", read }),
  { declarations: 0, recorded: 0 },
  "a complete matrix asks nothing — an answered hole does not reopen on a rewrite",
);
const twoBlanks = matrix({});
delete twoBlanks.cells["cart|paid"];
delete twoBlanks.cells["cart|refunded"];
writeFileSync(barrier(), renderContrastArtifact(twoBlanks));
assert.deepEqual(
  await recordMatrixQuestions(db, {
    cardId: "card_blank",
    stateDir,
    askedAt: 13,
    makeId: (declaration, index) => `askc_late_${index}`,
    read,
  }),
  { declarations: 1, recorded: 1 },
  "a second blank cell in another column asks its own question while the first stays answered",
);
assert.deepEqual(
  rowsFor("card_blank").map((row) => row.premise).sort(),
  ["cart|paid", "cart|refunded"],
  "both cells are recorded, each as its own premise",
);

// 4. No matrix, no question: a card that never ran the scope stage is not a
//    card with a hole in it.
assert.equal(
  await recordMatrixQuestions(db, { cardId: "card_none", stateDir, askedAt: 20, makeId: () => "unused", read: () => null }),
  null,
  "a missing artifact is no matrix, not an empty one",
);
assert.equal(
  await recordMatrixQuestions(db, { cardId: "card_none", stateDir: null, askedAt: 20, makeId: () => "unused", read }),
  null,
  "and a card with no state dir has nowhere to read a matrix from",
);
assert.equal(rowsFor("card_none").length, 0, "neither asked a question");

// 5. A document that is not a matrix is refused by the artifact's own sentence
//    rather than read as a matrix with every cell blank — which would ask a
//    question per cell about a file nobody can answer.
const prosePath = join(stateDir, "prose.md");
writeFileSync(prosePath, "# Contrast matrix\n\nwe have not decided yet\n");
await assert.rejects(
  () =>
    recordMatrixQuestions(db, {
      cardId: "card_prose",
      stateDir,
      askedAt: 30,
      makeId: () => "unused",
      read: (path) => read(path.replace(/contrast-matrix\.md$/, "prose.md")),
    }),
  /contrast-matrix\.md has no ```stelow-contrast block/,
  "a document with no matrix fence is refused, not read as an all-blank matrix",
);
assert.equal(rowsFor("card_prose").length, 0, "the refusal wrote nothing");

db.close();
rmSync(stateDir, { recursive: true, force: true });

console.log("contrast ask door ok: one blank cell asks one question, premise names the cell");
