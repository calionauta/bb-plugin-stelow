// Behavior: the two gate stages the generated catalog cannot contract yet —
// plan-gate's `tech` atom and diff-gate's `diff` atom — block advancing until
// a card question was answered AFTER the stage entry. An answer older than the
// entry is stale and does not count, an unselected gate stays automatic, and a
// state or inbox read the gate cannot trust fails open instead of inventing a
// deadlock.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createQuestionContractsGate } from "../server/runtime/question-contracts-gate.ts";

const card = { id: "card_1" };

function stateMarkdown(stage, gates) {
  return [
    "---",
    `current_stage: ${stage}`,
    "config:",
    // `standard` is not a valid quality for parseWorkflowConfig; strict mode
    // would null it, and the gate fails open before reaching the atom.
    "  quality: production",
    `  review_gates: ${gates}`,
    "  review_mode: Auto",
    "history:",
    `  - stage: ${stage}`,
    "    at: 2026-09-17T11:00:00Z",
    "    status: active",
    "---",
    "",
  ].join("\n");
}

function makeGate({
  state = stateMarkdown("plan-gate", "[tech]"),
  sync = async () => [],
  stateReadable = true,
} = {}) {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE inbox_events (id TEXT PRIMARY KEY, card_id TEXT, kind TEXT, "
      + "resolved_reason TEXT, resolved_at INTEGER)",
  );
  const bb = {
    sdk: {
      files: {
        read: async ({ path }) => {
          if (!stateReadable || !path.endsWith("state.md")) return null;
          return { content: state };
        },
        listPaths: async () => ({ paths: [] }),
      },
    },
  };
  const gate = createQuestionContractsGate({ bb, db, syncOpenQuestionInbox: sync });
  return { db, gate };
}

function markAnswered(db, resolvedAt) {
  db.prepare(
    "INSERT INTO inbox_events (id, card_id, kind, resolved_reason, resolved_at) VALUES (?, ?, ?, ?, ?)",
  ).run(`evt_${resolvedAt}`, card.id, "question", "answered", resolvedAt);
}

test("plan-gate with the tech gate refuses until a question is answered since entry", async () => {
  const { db, gate } = makeGate();
  const result = await gate(card, "/state");
  assert.equal(typeof result, "string", "an unanswered selected gate refuses advancing");
  assert.match(result, /technical-plan/, "the refusal names the technical-plan gate");
  assert.match(result, /bb stelow ask/, "and the ask command that produces the answer");
  assert.match(result, /--artifact/, "the refusal names the artifact that clears it");
  assert.match(result, /gate decision/, "and what the answer means");
  db.close();
});

test("an answer recorded since the stage entry satisfies the tech gate", async () => {
  const { db, gate } = makeGate();
  markAnswered(db, Date.parse("2026-09-17T11:05:00Z"));
  assert.equal(await gate(card, "/state"), null, "an answer 5 minutes after entry clears the refusal");
  db.close();
});

test("an answer older than the stage entry does not count", async () => {
  const { db, gate } = makeGate();
  markAnswered(db, Date.parse("2026-09-17T10:00:00Z"));
  const result = await gate(card, "/state");
  assert.equal(typeof result, "string", "a stale answer does not clear the selected gate");
  assert.match(result, /technical-plan/, "the same technical-plan refusal comes back");
  db.close();
});

test("an unselected plan gate stays automatic", async () => {
  const { db, gate } = makeGate({ state: stateMarkdown("plan-gate", "[]") });
  assert.equal(await gate(card, "/state"), null, "no tech atom means no human wait");
  db.close();
});

test("diff-gate with the diff gate refuses until an answer is recorded", async () => {
  const { db, gate } = makeGate({ state: stateMarkdown("diff-gate", "[diff]") });
  const result = await gate(card, "/state");
  assert.equal(typeof result, "string", "the selected diff gate is a human wait");
  assert.match(result, /code-diff/, "the refusal names the code-diff gate");
  assert.match(result, /bb stelow ask/, "and the ask command that produces the answer");
  assert.match(result, /--artifact/, "the refusal names the artifact that clears it");
  assert.doesNotMatch(result, /technical-plan/, "the tech refusal does not leak into the diff gate");
  db.close();
});

test("an unknown inbox sync fails open", async () => {
  const { db, gate } = makeGate({ sync: async () => null });
  assert.equal(await gate(card, "/state"), null, "a null sync is unknown, never a refusal");
  db.close();
});

test("an unreadable state.md fails open", async () => {
  const { db, gate } = makeGate({ stateReadable: false });
  assert.equal(await gate(card, "/state"), null, "no state means no gate to enforce");
  db.close();
});

console.log("gate human-answer test ok: tech/diff atoms, fresh vs stale answers, fail-open reads");
