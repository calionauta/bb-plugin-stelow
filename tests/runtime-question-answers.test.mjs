import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildGapSummary } from "../server/runtime/gap-summary.ts";
import { createCritiqueGapState } from "../server/runtime/critique-gap-state.ts";
import { createQuestionAnswers } from "../server/runtime/question-answers.ts";
import { answerDeps, card } from "./fixtures/answer-deps.mjs";
import { createQuestionContractsGate } from "../server/runtime/question-contracts-gate.ts";
import { createQualitySeal } from "../server/runtime/quality-seal.ts";

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

test("live answer writes one receipt, continuation, and recovery update", async () => {
  const { deps, calls } = answerDeps();
  const answer = createQuestionAnswers(deps);
  const result = await answer.answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.deepEqual(result, { ok: true, answered: 1, error: null, delivery: "sent", deliveryLine: null });
  assert.equal(calls.sends.length, 1);
  assert.equal(calls.answered[0], "ask_1");
  assert.match(calls.comments[0][4], /\[contract: direction-contract\]/);
  assert.deepEqual(calls.updates[0], {
    activity: "running",
    status: "in-progress",
    last_error: null,
  });
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
      gaps: [
        { description: "Need retry", resolution: "escalate" },
        { description: "Need logs", resolution: "escalate" },
        { description: "Typo", resolution: "fixed" },
      ],
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
    (status) => status === "skipped",
  );
  assert.equal(summary.pendingScopes, 1);
  assert.equal(summary.unscoped, 1);
  assert.equal(summary.items[0].scopeStatus, "planned");
  assert.equal(summary.done, true);
});

// The tally counts every finding; the list has to be able to account for it.
// This is the card that read "2 gaps" above an empty section: both findings
// were documented, so the escalated-only list had nothing to show.
test("gap summary lists documented and fixed findings, not only escalations", () => {
  const summary = buildGapSummary(
    card({ status: "completed" }),
    {
      matched: true,
      failures: [],
      totals: { total: 2, fixed: 0, documented: 2, escalated: 0 },
      gaps: [
        { description: "Docs drifted", resolution: "documented" },
        { description: "Naming is wrong", resolution: "documented" },
      ],
      escalated: [],
      auditGapScopes: [],
      critiqueText: "critique",
    },
    { leadMs: 10, cycleMs: 20 },
    (status) => status === "done",
  );
  assert.equal(summary.total, 2, "the header count is unchanged");
  assert.deepEqual(
    summary.items.map((item) => [item.description, item.resolution, item.scopeStatus]),
    [["Docs drifted", "documented", null], ["Naming is wrong", "documented", null]],
    "both documented gaps are listed, and a non-escalation never claims a rework scope",
  );
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
