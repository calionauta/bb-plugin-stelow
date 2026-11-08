// The live card case: opening a card whose scope stage wrote a contrast matrix
// with a blank cell records an open question whose premise is that cell, through
// the ask surface that already exists. Driven through the real detail handler,
// against a real SQLite database built by the plugin's own migrations and a real
// state dir on disk.
//
// This is the red proof the #419 record named as missing: with the call removed
// from loadDetailInputs, the first case below records zero questions and fails.
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderContrastArtifact } from "../lib/contrast-artifact.mjs";
import { ensureExecutionRunTable } from "../lib/execution-run-ledger.mjs";
import { questionPremises } from "../lib/question-contracts.mjs";
import { runPluginMigrations } from "../server/core-migrations.ts";
import { createCardDetailHandler } from "../server/runtime/card-detail.ts";
import { card, detailDeps } from "./helpers/card-detail-fixture.mjs";

function matrixWithBlankCell() {
  return {
    places: [
      { id: "cart", affordances: ["resume", "edit", "clear"] },
      { id: "checkout", affordances: ["request-refund"] },
    ],
    states: ["paid", "refunded"],
    cells: {
      "cart|refunded": ["clear"],
      "checkout|paid": ["request-refund"],
      "checkout|refunded": ["request-refund"],
    },
  };
}

function freshDatabase() {
  const db = new Database(":memory:");
  runPluginMigrations(
    { storage: { migrate: (_database, statements) => statements.forEach((statement) => db.exec(statement)) } },
    db,
    () => 1,
  );
  // The run ledger creates its own table at startup rather than in the core
  // migrator, and the detail reads it for the native-run line.
  ensureExecutionRunTable(db);
  return db;
}

const workspace = mkdtempSync(join(tmpdir(), "card-detail-contrast-"));
const stateDir = join(workspace, ".stelow", "2026-10-23", "sw-card_contrast");
mkdirSync(stateDir, { recursive: true });
mkdirSync(join(stateDir, "runs"), { recursive: true });
writeFileSync(join(stateDir, "contrast-matrix.md"), renderContrastArtifact(matrixWithBlankCell()));

const db = freshDatabase();

/** The host's file read, over this real directory. */
const files = {
  read: async ({ path }) => ({ content: existsSync(path) ? readFileSync(path, "utf8") : "" }),
  listPaths: async () => ({ paths: [] }),
};

/** A real card row: ask_contracts.card_id is a foreign key, and a fixture row
 * that exists only in memory is exactly the shortcut this test must not take. */
function insertCard(row) {
  const columns = new Set(db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name));
  const keys = Object.keys(row).filter((key) => columns.has(key));
  db.prepare(`INSERT INTO cards (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...keys.map((key) => row[key]));
}

function handlerFor(row, overrides = {}) {
  return createCardDetailHandler(detailDeps(row, {
    db,
    cardWorkspace: async () => ({ path: workspace, hostId: "host_1" }),
    stateDir: async () => stateDir,
    fetchPendingQuestions: async () => [],
    bb: {
      sdk: {
        projects: { get: async () => ({ name: "Project" }) },
        files,
        threads: { get: async () => ({ environmentId: "env_1" }) },
      },
      realtime: { publish: () => undefined },
    },
    ...overrides,
  }));
}

const cardWithMatrix = card({ workspace_path: workspace });

test("a blank cell becomes one open question whose premise is that cell", async () => {
  insertCard(cardWithMatrix);
  assert.equal(questionPremises(db, cardWithMatrix.id).length, 0, "the card starts with no recorded question");
  await handlerFor(cardWithMatrix)({ cardId: cardWithMatrix.id });

  const rows = questionPremises(db, cardWithMatrix.id);
  assert.equal(rows.length, 1, "opening the card asked exactly one question");
  assert.equal(rows[0].premise, "cart|paid", "and its premise names the blank cell");
  assert.equal(rows[0].consumedAt, null, "the question is open, so the answer door can consume it later");
  assert.match(rows[0].question, /cart offers nothing in state paid/, "the question is the matrix's, not a new phrasing");
});

test("reopening the card does not ask the same question twice", async () => {
  await handlerFor(cardWithMatrix)({ cardId: cardWithMatrix.id });
  await handlerFor(cardWithMatrix)({ cardId: cardWithMatrix.id });
  assert.equal(
    questionPremises(db, cardWithMatrix.id).length,
    1,
    "the detail is opened many times; one blank cell stays one question",
  );
});

test("a card with no matrix records nothing", async () => {
  const bare = card({ id: "card_no_matrix", workspace_path: workspace });
  insertCard(bare);
  await handlerFor(bare, { stateDir: async () => null })({ cardId: bare.id });
  assert.equal(questionPremises(db, bare.id).length, 0, "no matrix, no question");
});

test("a matrix the model refuses does not stop the card from opening", async () => {
  const broken = join(stateDir, "broken-state");
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, "contrast-matrix.md"), "```stelow-contrast\n{ not json }\n```\n");
  const refusedCard = card({ id: "card_broken_matrix", workspace_path: workspace });
  insertCard(refusedCard);
  const detail = await handlerFor(refusedCard, { stateDir: async () => broken })({ cardId: refusedCard.id });
  assert.equal(detail.card.id, refusedCard.id, "the human can still open the card");
  assert.equal(questionPremises(db, refusedCard.id).length, 0, "and a refused matrix asked nothing, never a premise-free question");
});

test.after(() => {
  db.close();
  rmSync(workspace, { recursive: true, force: true });
});

console.log("card detail contrast ok: a blank cell asks one question, premise names the cell");
