import assert from "node:assert/strict";
import test from "node:test";
import { createResearchTrackSync } from "../server/runtime/research-track-sync.ts";
import { isTerminalTrackStatus, settledIdleAt } from "../server/runtime/track-sync-core.ts";

const IDLE_ATTENTION_MS = 90_000;

function card(overrides = {}) {
  return {
    id: "card-1",
    name: "research-card",
    display_name: "Research card",
    status: "in-progress",
    activity: "running",
    kind: "research",
    explore_stage: null,
    worker_thread_id: "thread-1",
    preset_restart_pending: 0,
    last_assistant_text: null,
    last_idle_at: null,
    ...overrides,
  };
}

const READY = { ready: true, fingerprint: "fp-1", evidence: "verified", invalid: [] };

function createCalls() {
  return {
    reads: 0,
    updates: [],
    inbox: [],
    resolved: [],
    stages: [],
    notes: [],
    failed: [],
    escalated: [],
    researchReadiness: 0,
    exploreArtifact: 0,
  };
}

function createThreadApi(calls, options) {
  return {
    sdk: {
      threads: {
        get: async () => {
          calls.reads += 1;
          if (options.getThrows) throw new Error("thread host unavailable");
          return { status: options.status ?? "idle", createdAt: 1_700_000_000_000 };
        },
        output: async () => {
          if (options.outputThrows) throw new Error("output host unavailable");
          return { output: options.lastOutput ?? "worker said hello" };
        },
      },
    },
  };
}

function createDeps(options, state, calls) {
  return {
    bb: createThreadApi(calls, options),
    db: {
      prepare: () => ({
        run: () => {
          if (options.healThrows) throw new Error("staleness repair unavailable");
        },
      }),
    },
    now: () => options.now ?? 1_000_000,
    getCard: () => state.card,
    updateCard: (cardId, fields) => {
      state.card = { ...state.card, ...fields };
      calls.updates.push([cardId, fields]);
    },
    recordInboxEvent: (row, kind, message, key, at) =>
      calls.inbox.push({ kind, message, key, at, status: row.status }),
    resolvePausedEvents: (cardId, at) => calls.resolved.push([cardId, at]),
    recordStageEvent: (cardId, stage) => calls.stages.push([cardId, stage]),
    markThreadRunning: async (row, lastOutput) =>
      calls.notes.push(["running", row.id, lastOutput]),
    syncQuestions: async () => options.questionIds ?? [],
    noteAgentOutput: (row, lastOutput) => calls.notes.push(["note", row.id, lastOutput]),
    applyFailed: async (cardId, threadId, error) => calls.failed.push([cardId, threadId, error]),
    escalateIfStalled: (cardId) => calls.escalated.push(cardId),
    researchReadiness: async () => {
      calls.researchReadiness += 1;
      return options.readiness ?? READY;
    },
    exploreArtifact: async () => {
      calls.exploreArtifact += 1;
      return options.artifact ?? { ready: true, fingerprint: "fp-explore", failures: [] };
    },
    idleAttentionMs: IDLE_ATTENTION_MS,
  };
}

/** One harness per poll; call order and dependency reads are observable. */
function harness(options = {}) {
  const state = { card: card(options.card) };
  const calls = createCalls();
  const deps = createDeps(options, state, calls);
  return { sync: createResearchTrackSync(deps), deps, calls, state };
}

test("research settlement reads research readiness and never the explore artifact", async () => {
  const { sync, calls, state } = harness();
  await sync.syncResearch(state.card);
  assert.equal(calls.researchReadiness, 1);
  assert.equal(calls.exploreArtifact, 0);
});

test("explore settlement reads the explore artifact and never research readiness", async () => {
  const { sync, calls, state } = harness({ card: { kind: "explore", explore_stage: "shape-up" } });
  await sync.syncExplore(state.card);
  assert.equal(calls.exploreArtifact, 1);
  assert.equal(calls.researchReadiness, 0);
});

test("a completed research card is never polled or written", async () => {
  const { sync, calls, state } = harness({ card: { status: "completed" } });
  await sync.syncResearch(state.card);
  assert.equal(calls.reads, 0, "a terminal card never reads its thread");
  assert.deepEqual(calls.updates, []);
  assert.deepEqual(calls.inbox, []);
  assert.deepEqual(calls.escalated, [], "a terminal card never re-escalates");
});

test("a valid index completes the research card and records the review trail", async () => {
  const { sync, calls, state } = harness({ now: 500_000 });
  await sync.syncResearch(state.card);
  assert.deepEqual(calls.updates[0], [
    "card-1",
    {
      status: "completed",
      activity: "idle",
      last_assistant_text: "worker said hello",
      last_idle_at: 500_000,
    },
  ]);
  assert.deepEqual(calls.stages, [["card-1", "done"]], "a Done-column card leaves a done event");
  assert.deepEqual(calls.resolved, [["card-1", 500_000]], "paused events resolve on completion");
  assert.deepEqual(calls.inbox, [
    {
      kind: "completed",
      message: "Research complete — results ready to review in Done.",
      key: "completed:card-1:index:fp-1",
      at: 500_000,
      status: "completed",
    },
  ]);
});

test("hypothesis-only evidence reaches the human in the completion note", async () => {
  const { sync, calls, state } = harness({
    readiness: { ...READY, fingerprint: "fp-2", evidence: "hypothesis-only" },
  });
  await sync.syncResearch(state.card);
  assert.match(calls.inbox[0].message, /hypothesis-only/);
  assert.match(calls.inbox[0].message, /requires human validation/);
});

test("invalid research rounds park the card and name every defect before the idle nudge", async () => {
  const { sync, calls, state } = harness({
    now: 1_000_000,
    card: { activity: "idle", last_idle_at: 800_000 },
    readiness: {
      ready: false,
      fingerprint: null,
      evidence: "verified",
      invalid: [
        { n: 1, label: "JTBD — Interview prompts", slug: "interview-prompts", reason: "thin" },
        { n: 2, label: "Pricing", reason: "needs-depth", detail: "no competitor table" },
        { n: 3, label: "Ads" },
      ],
    },
  });
  await sync.syncResearch(state.card);
  assert.deepEqual(
    calls.updates[0][1],
    { activity: "idle", last_assistant_text: "worker said hello", last_idle_at: 800_000 },
    "an already-idle card keeps its original idle stamp",
  );
  assert.deepEqual(calls.stages, [], "an unfinished index is never a done event");
  assert.deepEqual(calls.inbox.map((entry) => entry.kind), ["error", "error", "error", "paused"]);
  assert.match(
    calls.inbox[0].message,
    /Round 1 \(JTBD — Interview prompts — interview-prompts\) thin — write the full playbook output/,
  );
  assert.equal(calls.inbox[0].key, "round-invalid:card-1:1:interview-prompts");
  assert.match(calls.inbox[1].message, /needs depth: no competitor table/);
  assert.equal(calls.inbox[1].key, "round-invalid:card-1:2");
  assert.match(calls.inbox[2].message, /Round 3 \(Ads\) incomplete/);
  assert.equal(calls.inbox[3].key, "paused:card-1:800000", "the generic nudge comes after the specific defects");
});

test("a fresh idle stamp below the attention window stays quiet", async () => {
  const { sync, calls, state } = harness({
    readiness: { ready: false, fingerprint: null, evidence: "verified", invalid: [] },
  });
  await sync.syncResearch(state.card);
  assert.deepEqual(calls.inbox, [], "a card that just went idle is not yet actionable");
});

test("an unreadable readiness read never completes the card", async () => {
  const { deps, sync: base, calls, state } = harness();
  const sync = createResearchTrackSync({
    ...deps,
    researchReadiness: async () => {
      throw new Error("state dir vanished");
    },
  });
  assert.ok(base, "the factory composes the same shape when a dependency throws");
  await sync.syncResearch(state.card);
  assert.equal(calls.updates[0][1].status, undefined, "fail-soft readiness cannot fake a completion");
  assert.equal(calls.updates[0][1].activity, "idle");
  assert.deepEqual(calls.stages, []);
});

test("an open question parks the research card without reading readiness", async () => {
  const { deps, calls, state } = harness({ questionIds: ["q-1"] });
  let readinessCalls = 0;
  const sync = createResearchTrackSync({
    ...deps,
    researchReadiness: async () => {
      readinessCalls += 1;
      return READY;
    },
  });
  await sync.syncResearch(state.card);
  assert.equal(readinessCalls, 0, "a waiting worker is not done yet");
  assert.equal(calls.updates.length, 1);
  assert.ok(calls.updates[0][1].activity, "the question wait still updates the card");
  assert.deepEqual(calls.inbox, []);
});

test("a completed explore artifact completes the explore card", async () => {
  const { sync, calls, state } = harness({
    card: { kind: "explore", explore_stage: "shape-up" },
    now: 700_000,
  });
  await sync.syncExplore(state.card);
  assert.equal(calls.updates[0][1].status, "completed");
  assert.deepEqual(calls.stages, [["card-1", "done"]]);
  assert.equal(calls.inbox[0].key, "explore-completed:card-1:fp-explore");
  assert.match(calls.inbox[0].message, /Exploration complete/);
});

test("a thin explore artifact names its depth failures before the idle nudge", async () => {
  const { sync, calls, state } = harness({
    card: { kind: "explore", explore_stage: "shape-up", activity: "idle", last_idle_at: 500_000 },
    artifact: { ready: false, fingerprint: null, failures: ["missing competitor table", "no score"] },
  });
  await sync.syncExplore(state.card);
  assert.equal(calls.updates[0][1].status, undefined);
  assert.deepEqual(calls.inbox.map((entry) => entry.kind), ["error", "paused"]);
  assert.match(
    calls.inbox[0].message,
    /Explore shape-up needs depth — missing competitor table; no score/,
  );
  assert.equal(calls.inbox[0].key, "explore-invalid:card-1");
  assert.equal(calls.inbox[1].key, "paused:card-1:500000");
});

test("an already-completed explore card with a ready artifact is left alone", async () => {
  const { sync, calls, state } = harness({ card: { kind: "explore", status: "completed" } });
  await sync.syncExplore(state.card);
  assert.equal(calls.reads, 0);
  assert.deepEqual(calls.updates, []);
});

test("an unreadable explore artifact never fakes completion", async () => {
  const { deps, calls, state } = harness({ card: { kind: "explore" } });
  let reads = 0;
  const sync = createResearchTrackSync({
    ...deps,
    exploreArtifact: async () => {
      reads += 1;
      throw new Error("artifact read failed");
    },
  });
  await sync.syncExplore(state.card);
  assert.equal(reads, 1);
  assert.equal(calls.updates[0][1].status, undefined);
  assert.deepEqual(calls.stages, []);
  assert.deepEqual(calls.inbox, [], "a fresh idle artifact has no depth complaint");
});

test("output and staleness repair remain best-effort inside a successful poll", async () => {
  const { sync, calls, state } = harness({ outputThrows: true, healThrows: true });
  await sync.syncResearch(state.card);
  assert.deepEqual(calls.updates[0][1], {
    status: "completed",
    activity: "idle",
    last_assistant_text: null,
    last_idle_at: 1_000_000,
  });
  assert.deepEqual(calls.stages, [["card-1", "done"]]);
});

test("a failed thread is handed to the failure writer, not the idle path", async () => {
  const { sync, calls, state } = harness({ status: "error" });
  await sync.syncExplore(state.card);
  assert.deepEqual(calls.failed, [["card-1", "thread-1", null]]);
  assert.deepEqual(calls.updates, []);
  assert.deepEqual(calls.escalated, ["card-1"]);
});

test("a thread read that throws fails soft onto an error activity", async () => {
  const { sync, calls, state } = harness({ getThrows: true });
  await sync.syncResearch(state.card);
  assert.deepEqual(calls.updates[0][1], {
    activity: "error",
    last_error: "thread host unavailable",
  });
  assert.deepEqual(calls.escalated, ["card-1"], "a broken poll still escalates the stall");
});

test("a question inbox that cannot resolve stops the poll before any completion", async () => {
  const { deps, calls, state } = harness();
  const sync = createResearchTrackSync({ ...deps, syncQuestions: async () => null });
  await sync.syncResearch(state.card);
  assert.deepEqual(calls.updates, []);
  assert.deepEqual(calls.escalated, [], "an unresolvable inbox is not a stall");
});

test("an open question while running keeps the card in its column", async () => {
  const { sync, calls, state } = harness({ status: "active", questionIds: ["q-1"] });
  await sync.syncResearch(state.card);
  assert.deepEqual(calls.notes, [["running", "card-1", "worker said hello"]]);
  assert.deepEqual(calls.inbox, []);
});

test("an idle worker's new output lands as one agent comment", async () => {
  const { sync, calls, state } = harness({ lastOutput: "finished the index" });
  await sync.syncResearch(state.card);
  assert.deepEqual(calls.notes, [["note", "card-1", "finished the index"]]);
});

test("the shared core keeps one terminal-status vocabulary for both tracks", () => {
  for (const status of ["completed", "archived", "blocked"]) {
    assert.equal(isTerminalTrackStatus(status), true, `${status} is terminal`);
  }
  for (const status of ["pending", "in-progress", "needs-review", ""]) {
    assert.equal(isTerminalTrackStatus(status), false, `${status} is not terminal`);
  }
  const now = () => 42;
  assert.equal(settledIdleAt(card({ activity: "idle", last_idle_at: 7 }), now), 7);
  assert.equal(settledIdleAt(card({ activity: "running", last_idle_at: 7 }), now), 42);
});
