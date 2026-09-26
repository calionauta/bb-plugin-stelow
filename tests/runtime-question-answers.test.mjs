import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildGapSummary } from "../server/runtime/gap-summary.ts";
import { createCritiqueGapState } from "../server/runtime/critique-gap-state.ts";
import { createQuestionAnswers } from "../server/runtime/question-answers.ts";
import { createQuestionContractsGate } from "../server/runtime/question-contracts-gate.ts";
import { createQualitySeal } from "../server/runtime/quality-seal.ts";

function card(overrides = {}) {
  return {
    id: "card_1",
    project_id: "project_1",
    name: "Card",
    display_name: "Card",
    prompt: "Build",
    intent: "feature",
    status: "in-progress",
    stage: "shape",
    activity: "awaiting-answer",
    worker_thread_id: "thread_1",
    worker_preset_id: null,
    preset_restart_pending: null,
    dir_hash: "hash",
    auto_continue_count: null,
    auto_continue_stage: null,
    spawn_retry_count: null,
    spawn_retry_thread: null,
    attachments: "",
    workspace_kind: "project",
    workspace_path: null,
    workspace_host_id: null,
    kind: "build",
    research_strategy: null,
    research_strategies: null,
    explore_stage: null,
    last_error: "stale failure",
    last_assistant_text: null,
    last_idle_at: null,
    environment_label: null,
    created_at: 1_000,
    updated_at: 2_000,
    ...overrides,
  };
}

function gateDeps(state, receipts = {}) {
  const files = {
    "/state/state.md": { content: state },
    ...Object.fromEntries(Object.entries(receipts).map(([name, file]) => [
      `/state/${name}`,
      file,
    ])),
  };
  return {
    bb: {
      sdk: {
        files: {
          read: async ({ path }) => files[path] ?? null,
          listPaths: async () => ({ paths: Object.keys(files) }),
        },
      },
    },
    db: { prepare: () => ({ get: () => undefined }) },
    syncOpenQuestionInbox: async () => [],
  };
}

const shapeState = readFileSync(
  new URL("./fixtures/question-contracts/shape.state.md", import.meta.url),
  "utf8",
);
const enteredAt = [...shapeState.matchAll(/^\s+at:\s*([^\n]+)$/gm)].at(-1);

test("question gate refuses stale receipt evidence and accepts a fresh one", async () => {
  const entered = Date.parse(enteredAt[1]);
  const gate = createQuestionContractsGate(gateDeps(shapeState, {
    "plans/spec-product_v2.md": {
      content: "---\nassumptions_resolved: []\n---",
      modifiedAtMs: entered - 1,
    },
  }));
  assert.match(
    await gate(card(), "/state"),
    /write the fresh receipt/,
  );
  const freshGate = createQuestionContractsGate(gateDeps(shapeState, {
    "plans/spec-product_v2.md": {
      content: "---\nassumptions_resolved: []\n---",
      modifiedAtMs: entered,
    },
  }));
  assert.equal(await freshGate(card(), "/state"), null);
});

test("question gate fails open when inbox synchronization is unknown", async () => {
  const deps = gateDeps(shapeState);
  deps.syncOpenQuestionInbox = async () => null;
  const gate = createQuestionContractsGate(deps);
  assert.equal(await gate(card(), "/state"), null);
});

function answerDeps(overrides = {}) {
  const calls = { comments: [], sends: [], updates: [], answered: [] };
  const db = {
    prepare(sql) {
      if (sql.includes("SELECT id, thread_id, question")) {
        return { all: () => overrides.expiredRows ?? [] };
      }
      return { run: (id) => calls.answered.push(id) };
    },
    transaction: (fn) => fn,
  };
  const bb = {
    sdk: {
      threads: {
        interactions: { respond: async () => undefined },
        send: async (input) => calls.sends.push(input),
      },
    },
    realtime: { publish: () => undefined },
  };
  return {
    calls,
    deps: {
      bb,
      db,
      errors: { cardNotFound: "missing", cardArchived: "archived" },
      getCard: () => card(),
      isArchivedCard: () => false,
      pendingAsks: async () => overrides.asks ?? [{
        id: "ask_1",
        payload: {
          question: "Which direction?",
          multiple: false,
          options: [{ label: "A", description: "" }, { label: "B", description: "" }],
        },
      }],
      openExpiredQuestionIds: () => [],
      syncPendingQuestionInbox: () => undefined,
      syncOpenQuestionInbox: async () => [],
      markInboxQuestionsAnswered: (cardId, ids) => calls.answered.push(...ids),
      recordSplitAnswer: () => undefined,
      consumeAskContract: () => "direction-contract",
      logCardComment: (...args) => calls.comments.push(args),
      updateCard: (cardId, fields) => calls.updates.push(fields),
      hasOpenQuestions: () => false,
      ...overrides.deps,
    },
  };
}

test("live answer writes one receipt, continuation, and recovery update", async () => {
  const { deps, calls } = answerDeps();
  const answer = createQuestionAnswers(deps);
  const result = await answer.answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.deepEqual(result, { ok: true, answered: 1, error: null });
  assert.equal(calls.sends.length, 1);
  assert.equal(calls.answered[0], "ask_1");
  assert.match(calls.comments[0][4], /\[contract: direction-contract\]/);
  assert.deepEqual(calls.updates[0], {
    activity: "running",
    status: "in-progress",
    last_error: null,
  });
});

test("live answer refuses an unknown question without resuming the worker", async () => {
  const { deps, calls } = answerDeps();
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_missing", answers: ["A"] }],
  });
  assert.match(result.error, /No open question/);
  assert.equal(calls.sends.length, 0);
  assert.equal(calls.updates.length, 0);
});

test("archived cards refuse live and expired answers before persistence", async () => {
  const { deps, calls } = answerDeps({
    expiredRows: [],
    deps: { isArchivedCard: () => true },
  });
  const answer = createQuestionAnswers(deps);
  const live = await answer.answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  const expired = await answer.answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: ["A"] }],
  });
  assert.equal(live.error, "archived");
  assert.equal(expired.error, "archived");
  assert.equal(calls.sends.length, 0);
  assert.equal(calls.comments.length, 0);
});

test("expired answers remain all-or-nothing and use the current worker", async () => {
  const rows = [
    { id: "old_1", thread_id: "old_thread", question: "Q1?" },
    { id: "old_2", thread_id: "old_thread", question: "Q2?" },
  ];
  const { deps, calls } = answerDeps({
    expiredRows: rows,
    deps: { getCard: () => card({ worker_thread_id: "current_thread" }) },
  });
  const answer = createQuestionAnswers(deps);
  const refused = await answer.answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: ["A"] }],
  });
  assert.match(refused.error, /Answer every pending question/);
  assert.equal(calls.comments.length, 0);
  assert.equal(calls.answered.length, 0);
  const accepted = await answer.answerExpiredQuestions({
    cardId: "card_1",
    answers: rows.map((row) => ({ questionId: row.id, answers: ["A"] })),
  });
  assert.equal(accepted.ok, true);
  assert.equal(calls.sends[0].threadId, "current_thread");
  assert.equal(calls.comments.length, 2);
});

test("critique reader treats an unknown state as unmatched", async () => {
  const read = createCritiqueGapState({
    bb: { sdk: { files: { read: async () => null } } },
    cardWorkspace: async () => ({ path: "/repo", hostId: null }),
    workflowStateDir: async () => "/state",
    loadCardScopes: () => [],
  });
  const state = await read(card());
  assert.equal(state.matched, false);
  assert.equal(state.failures.length, 0);
  assert.equal(state.critiqueText, "");
});

test("gap summary links escalated gaps and reports unscoped ones", () => {
  const summary = buildGapSummary(
    card({ status: "completed" }),
    {
      matched: true,
      failures: [],
      totals: { total: 3, fixed: 1, documented: 1, escalated: 1 },
      escalated: [{ description: "Need retry" }, { description: "Need logs" }],
      auditGapScopes: [{
        id: "scope_1",
        name: "Retry",
        status: "planned",
        gap: "Need retry",
      }],
      critiqueText: "critique",
    },
    { leadMs: 10, cycleMs: 20 },
    (status) => status === "done",
  );
  assert.equal(summary.pendingScopes, 1);
  assert.equal(summary.unscoped, 1);
  assert.equal(summary.items[0].scopeStatus, "planned");
  assert.equal(summary.done, true);
});

test("quality seal never trusts an unknown artifact path", async () => {
  const seal = createQualitySeal({
    bb: { sdk: { files: { read: async () => ({ content: "# unknown" }) } } },
    getCard: () => card(),
    getCardByWorkerThread: () => null,
    cardWorkspace: async () => ({ path: "/repo", hostId: null }),
    strategyRounds: () => [],
    readResearchIndex: async () => null,
  });
  const result = await seal({ cardId: "card_1", path: "notes.md" });
  assert.deepEqual(result, {
    status: "unverified",
    failures: [],
    evidence: null,
    label: null,
  });
});
