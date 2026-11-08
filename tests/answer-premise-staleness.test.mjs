import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createQuestionAnswers } from "../server/runtime/question-answers.ts";
import { renderContrastArtifact } from "../lib/contrast-artifact.mjs";
import { observeFromCard, premiseVerdict } from "../lib/premise-staleness.mjs";

// The ANSWER DOOR is where a premise verdict becomes visible on the card. The
// store is real in tests/contrast-asks (SQLite) and the derivation is real here:
// a matrix on disk is the observation a rewind changes, so this test proves the
// door (a) hands that observation to the store and (b) leaves the stale ground
// on the trail instead of recording a decision that reads as current.

function card() {
  return {
    id: "card_1",
    status: "in-progress",
    stage: "interface",
    activity: "awaiting-answer",
    worker_thread_id: "thread_1",
    dir_hash: "hash",
    workspace_path: "/repo",
    kind: "build",
  };
}

function answerDeps(overrides = {}) {
  const calls = { comments: [], sends: [], updates: [] };
  const db = {
    prepare(sql) {
      if (sql.includes("SELECT id, thread_id, question")) return { all: () => [] };
      return { run: () => undefined };
    },
    transaction: (fn) => fn,
  };
  return {
    calls,
    deps: {
      bb: {
        sdk: {
          threads: {
            interactions: { respond: async () => undefined },
            send: async (input) => calls.sends.push(input),
          },
        },
        realtime: { publish: () => undefined },
      },
      db,
      errors: { cardNotFound: "missing", cardArchived: "archived" },
      getCard: () => card(),
      isArchivedCard: () => false,
      pendingAsks: async () => [{
        id: "ask_1",
        payload: {
          question: "cart offers nothing in paid — a missing feature, or deliberately absent?",
          multiple: false,
          options: [{ label: "Add an affordance", description: "" }, { label: "Record the absence", description: "" }],
        },
      }],
      openExpiredQuestionIds: () => [],
      syncPendingQuestionInbox: () => undefined,
      syncOpenQuestionInbox: async () => [],
      markInboxQuestionsAnswered: () => undefined,
      recordSplitAnswer: () => undefined,
      logCardComment: (...args) => calls.comments.push(args),
      updateCard: (cardId, fields) => calls.updates.push(fields),
      hasOpenQuestions: () => false,
      ...overrides,
    },
  };
}

function matrix() {
  return {
    places: [
      { id: "cart", affordances: ["resume", "edit"] },
      { id: "checkout", affordances: ["confirm"] },
    ],
    states: ["paid", "refunded"],
    cells: {
      "cart|paid": ["edit"],
      "cart|refunded": ["resume"],
      "checkout|paid": ["confirm"],
      "checkout|refunded": [],
    },
  };
}

/** The store boundary, driven by the REAL premise derivation: the contract is
 * claimed only while the premise the observation sees is still there. */
function storeWith(observe) {
  return {
    premiseObservation: async () => observe,
    consumeAnsweredContract: (db, cardId, question, options) => {
      const verdict = premiseVerdict("cart|paid", options?.observe);
      return { contract: verdict?.stale ? null : "direction-contract", premise: "cart|paid", verdict };
    },
  };
}

test("a surviving premise keeps its contract and leaves no stale note", async () => {
  const dir = mkdtempSync(join(tmpdir(), "answer-premise-"));
  writeFileSync(join(dir, "contrast-matrix.md"), renderContrastArtifact(matrix()));
  const { deps, calls } = answerDeps(storeWith(observeFromCard({ stateDir: dir })));

  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["Add an affordance"] }],
  });

  assert.equal(result.ok, true, "the answer is accepted");
  assert.match(calls.comments[0][4], /\[contract: direction-contract\]/, "a live premise claims its contract");
  assert.doesNotMatch(calls.comments[0][4], /Stale decision/, "a surviving premise leaves no stale note");
  rmSync(dir, { recursive: true, force: true });
});

test("a premise the rewind removed is trailed as a stale decision", async () => {
  const dir = mkdtempSync(join(tmpdir(), "answer-premise-"));
  // The rewind: `paid` is gone from the matrix, so `cart|paid` no longer exists.
  writeFileSync(
    join(dir, "contrast-matrix.md"),
    renderContrastArtifact({ ...matrix(), states: ["refunded"], cells: { "cart|refunded": ["resume"] } }),
  );
  const { deps, calls } = answerDeps(storeWith(observeFromCard({ stateDir: dir })));

  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["Add an affordance"] }],
  });

  assert.equal(result.ok, true, "the answer is still recorded: a human decision is not deleted by a rewind");
  const trail = calls.comments[0][4];
  assert.doesNotMatch(trail, /\[contract:/, "a stale answer claims no contract");
  assert.match(
    trail,
    /Stale decision: its premise no longer exists \(cart\|paid\)/,
    "the trail names the cell that is gone, not a generic warning",
  );
  rmSync(dir, { recursive: true, force: true });
});
