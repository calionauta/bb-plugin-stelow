import { createResearchTrackSync } from "../../server/runtime/research-track-sync.ts";

/**
 * The shared harness for the research/explore track sweep.
 *
 * Extracted for the same reason as the build sync's: the host-hold rule is
 * asserted on all three tracks, and a second copy of this fake would be a
 * second thing to forget to update when a dep changes — which is exactly how
 * `readHold` would have gone missing from one of the two suites.
 */

export const IDLE_ATTENTION_MS = 90_000;

export const READY = { ready: true, fingerprint: "fp-1", evidence: "verified", invalid: [] };

export function card(overrides = {}) {
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
        queuedMessages: {
          list: async () => (options.queuedMessages ?? []),
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
    // The paused path no longer records per idle period: it refreshes the
    // card's one open row, so the fake mirrors the real one-row-per-card
    // contract rather than appending a row per call.
    upsertPausedEvent: (cardId, message, idleAt) => {
      const already = calls.inbox.find((entry) => entry.kind === "paused" && entry.open);
      if (already) {
        already.at = idleAt;
        return;
      }
      calls.inbox.push({ kind: "paused", message, key: `paused:${cardId}:${idleAt}`, at: idleAt, open: true });
    },
    resolvePausedEvents: (cardId, at) => calls.resolved.push([cardId, at]),
    recordStageEvent: (cardId, stage) => calls.stages.push([cardId, stage]),
    markThreadRunning: async (row, lastOutput) =>
      calls.notes.push(["running", row.id, lastOutput]),
    syncQuestions: async () => options.questionIds ?? [],
    readHold: async () => options.hold ?? null,
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
export function harness(options = {}) {
  const state = { card: card(options.card) };
  const calls = createCalls();
  const deps = createDeps(options, state, calls);
  return { sync: createResearchTrackSync(deps), deps, calls, state };
}
