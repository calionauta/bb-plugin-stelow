import assert from "node:assert/strict";
import test from "node:test";
import { createCardDetailHandler } from "../server/runtime/card-detail.ts";
import { createCardMutationHandlers } from "../server/runtime/card-mutations.ts";
import { createCardLifecycleHandlers } from "../server/runtime/card-lifecycle.ts";

function card(overrides = {}) {
  return {
    id: "card_1",
    project_id: "proj_1",
    name: "card",
    display_name: "Card",
    prompt: "Build a useful thing",
    intent: "feature",
    status: "in-progress",
    stage: "planning",
    activity: "running",
    worker_thread_id: null,
    worker_preset_id: null,
    preset_restart_pending: 0,
    dir_hash: null,
    auto_continue_count: 0,
    auto_continue_stage: null,
    spawn_retry_count: 0,
    spawn_retry_thread: null,
    attachments: "[]",
    workspace_kind: "project",
    workspace_path: null,
    workspace_host_id: null,
    kind: "build",
    research_strategy: null,
    research_strategies: null,
    explore_stage: null,
    last_error: null,
    last_assistant_text: null,
    last_idle_at: null,
    environment_label: null,
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

function database() {
  return {
    prepare(_sql) {
      return {
        all: () => [],
        get: () => undefined,
        run: () => undefined,
      };
    },
  };
}

function detailDeps(row, overrides = {}) {
  const events = [];
  const db = database();
  return {
    db,
    bb: {
      sdk: {
        projects: { get: async () => ({ name: "Project" }) },
        files: { read: async () => ({ content: "" }), listPaths: async () => ({ paths: [] }) },
        threads: { get: async () => ({ environmentId: "env_1" }) },
      },
      realtime: { publish: (...event) => events.push(event) },
    },
    now: () => 100,
    idleAttentionMs: 90_000,
    getCard: () => row,
    cardWorkspace: async () => null,
    syncThreadState: async () => undefined,
    fetchPendingQuestions: async () => [{
      id: "q1",
      title: "Question",
      question: "Choose",
      multiple: false,
      kind: "standard",
      options: [],
      expiresAt: null,
    }],
    resolveAskOptions: async (_card, options) => options,
    cardAttachments: () => [],
    detectMentionedFiles: async () => [],
    workspaceRelative: () => null,
    parseNextStages: () => ["execution"],
    getReliablePreset: () => ({ id: "p1", name: "Default", provider_id: "pi", model_id: "m1" }),
    strategyList: () => [],
    flowTimes: () => ({ leadMs: null, cycleMs: null }),
    verifiedHeadSha: () => null,
    workers: { history: async () => [] },
    executionLifecycle: { detailList: () => [] },
    stalenessForQuestions: async () => new Map(),
    stateDir: async () => null,
    fileTimestamp: (_file, fallback) => fallback,
    auditReceiptNote: () => null,
    cardNotFound: "Card not found.",
    ...overrides,
  };
}

test("card detail preserves question projection and missing-card refusal", async () => {
  const row = card();
  const handler = createCardDetailHandler(detailDeps(row));
  const result = await handler({ cardId: row.id });
  assert.equal(result.card.activity, "awaiting-answer");
  assert.equal(result.pendingQuestions[0].staleness, null);
  assert.deepEqual(result.nextStages, ["execution"]);

  const missing = createCardDetailHandler(detailDeps(row, {
    getCard: () => undefined,
    cardWorkspace: async () => {
      throw new Error("must not read a missing card");
    },
  }));
  await assert.rejects(() => missing({ cardId: "missing" }), /Card not found\./);
});

test("card detail keeps removed projects and unreadable state fail-soft", async () => {
  const row = card({ workspace_kind: "project" });
  const handler = createCardDetailHandler(detailDeps(row, {
    bb: {
      sdk: {
        projects: { get: async () => { throw new Error("removed"); } },
        files: { read: async () => { throw new Error("unreadable"); }, listPaths: async () => ({ paths: [] }) },
        threads: { get: async () => ({ environmentId: "env_1" }) },
      },
      realtime: { publish: () => undefined },
    },
    cardWorkspace: async () => ({ path: null, hostId: null }),
    syncThreadState: async () => { throw new Error("stale worker"); },
  }));
  const result = await handler({ cardId: row.id });
  assert.equal(result.card.projectName, "proj_1");
  assert.deepEqual(result.stageSkips.offRoute, []);
  assert.ok(result.stageSkips.skipped.length > 0);
});

function mutationDeps(row) {
  const calls = [];
  const db = database();
  return {
    calls,
    db,
    handlers: createCardMutationHandlers({
      db,
      bb: {
        sdk: {
          files: {
            read: async () => ({ content: "intent: old\n" }),
            write: async ({ content }) => calls.push(["write", content]),
          },
          threads: { send: async (input) => calls.push(["send", input]) },
        },
        realtime: { publish: (...event) => calls.push(["publish", ...event]) },
      },
      now: () => 10,
      getCard: () => row,
      cardWorkspace: async () => ({ path: "/project", hostId: "host" }),
      workflowStateDir: async () => "/project/.stelow/run",
      logCardComment: (...args) => {
        calls.push(["comment", ...args]);
        return "comment_1";
      },
      updateCard: (...args) => calls.push(["update", ...args]),
      errors: { cardNotFound: "missing", cardArchived: "archived" },
    }),
  };
}

test("card mutations preserve worker routing and archived refusal", async () => {
  const row = card({ status: "triage", stage: "triage", worker_thread_id: "thread_1" });
  const mutation = mutationDeps(row);
  assert.deepEqual(
    await mutation.handlers.updateCardIntent({ cardId: row.id, intent: "bugfix" }),
    { ok: true, error: null },
  );
  assert.equal(await mutation.handlers.renameCard({ cardId: row.id, name: "  " }).then((r) => r.ok), true);
  const comment = await mutation.handlers.addCardComment({
    cardId: row.id,
    target: "card",
    targetId: row.id,
    body: "hello",
  });
  assert.deepEqual(comment, { commentId: "comment_1", error: null });
  assert.ok(mutation.calls.some(([name]) => name === "send"));

  const archived = mutationDeps(card({ status: "archived" }));
  assert.deepEqual(
    await archived.handlers.addCardComment({
      cardId: "card_1",
      target: "card",
      targetId: "card_1",
      body: "no",
    }),
    { commentId: "", error: "This card is archived." },
  );
  assert.equal(archived.calls.some(([name]) => name === "comment"), false);
});

test("intent ownership refusal remains a negative control", async () => {
  const row = card({ status: "triage", stage: "triage", dir_hash: "hash" });
  const mutation = mutationDeps(row);
  // Rebuild with the same observable dependencies and the missing owner path.
  const handlers = createCardMutationHandlers({
    db: mutation.db,
    bb: {
      sdk: { files: {}, realtime: { publish: () => undefined } },
      realtime: { publish: () => undefined },
    },
    now: () => 10,
    getCard: () => row,
    cardWorkspace: async () => ({ path: "/project", hostId: "host" }),
    workflowStateDir: async () => null,
    logCardComment: () => "comment",
    updateCard: () => undefined,
    errors: { cardNotFound: "missing", cardArchived: "archived" },
  });
  assert.deepEqual(
    await handlers.updateCardIntent({ cardId: row.id, intent: "bugfix" }),
    {
      ok: false,
      error: "Workflow state ownership cannot be verified. Reseed this card before changing its workflow type.",
    },
  );
});

function lifecycleDeps(row, overrides = {}) {
  const calls = [];
  const evidence = {
    status: "active",
    workspaceKind: "project",
    checkoutPath: "/project",
    dirExists: true,
    isGit: true,
    branch: "feature",
    hasUpstream: true,
    upstreamRef: "origin/main",
    changed: ["a.ts"],
    untracked: ["b.ts"],
    unpushedCommits: 1,
    stashCount: 0,
    resetTarget: "origin/main",
    linkedWorktree: true,
    sharedWith: 0,
  };
  const deps = {
    db: database(),
    bb: { realtime: { publish: (...event) => calls.push(event) } },
    getCard: () => row,
    cardWorkspace: async () => null,
    workflowStateDir: async () => null,
    workers: { stop: async () => calls.push(["stop"]), deleteCard: () => calls.push(["delete"]) },
    stopOwnedRuns: async (cardId, reason) => {
      calls.push(["stopOwnedRuns", cardId, reason]);
      return overrides.stopOwnedRuns ?? true;
    },
    cancelScopeBatches: (cardId, reason) => calls.push(["cancelScopeBatches", cardId, reason]),
    updateCard: (...args) => calls.push(["update", ...args]),
    releaseClaims: async () => calls.push(["release"]),
    removeCardPreset: () => calls.push(["preset"]),
    logCardComment: () => "comment",
    runGitIn: async () => ({ ok: true, stdout: "" }),
    exploratoryScope: "/tmp/exploratory",
    discardEvidence: async () => evidence,
    discardEligibility: () => ({ eligible: true, action: "branch-reset", reason: null }),
    discardConfirm: () => ({ title: "Reset", body: "Reset branch" }),
    discardTrail: () => "Reset branch",
    errors: { cardNotFound: "missing" },
  };
  return { calls, handlers: createCardLifecycleHandlers(deps) };
}

test("card lifecycle preserves archive/delete boundaries and discard preview", async () => {
  const active = lifecycleDeps(card());
  assert.deepEqual(
    await active.handlers.deleteCard({ cardId: "card_1" }),
    { deleted: false, error: "Only archived cards can be deleted. Archive it first." },
  );
  assert.deepEqual(await active.handlers.cancelCard({ cardId: "card_1" }), { archived: true });
  assert.ok(active.calls.some(([name]) => name === "stop"));

  const archived = lifecycleDeps(card({ status: "archived" }));
  assert.deepEqual(
    await archived.handlers.discardPreview({ cardId: "card_1" }),
    {
      eligible: true,
      action: "branch-reset",
      reason: null,
      branch: "feature",
      files: ["a.ts", "b.ts"],
      fileCount: 2,
      commitCount: 1,
      sharedWith: 0,
      confirmTitle: "Reset",
      confirmBody: "Reset branch",
      error: null,
    },
  );
  assert.deepEqual(
    await archived.handlers.deleteCard({ cardId: "card_1" }),
    { deleted: true, error: null },
  );
  assert.ok(archived.calls.some(([name]) => name === "delete"));
});

// Archiving a card must stop the native runs it still owns and sweep its scope
// batches: a run or a batch that outlives its card keeps owning files nobody
// released. Removing either call passes every other assertion in this file, so
// it is pinned here.
test("archive and delete stop owned runs and sweep scope batches", async () => {
  const active = lifecycleDeps(card());
  assert.deepEqual(await active.handlers.cancelCard({ cardId: "card_1" }), { archived: true });
  assert.ok(
    active.calls.some(([name, , reason]) => name === "stopOwnedRuns" && reason === "card-archived"),
    "archiving stops the card's owned native runs",
  );
  assert.ok(
    active.calls.some(([name, , reason]) => name === "cancelScopeBatches" && reason === "card-archived"),
    "archiving sweeps the card's scope batches",
  );
  assert.ok(
    active.calls.some(([name]) => name === "release"),
    "the generic claim release still runs after the batch sweep",
  );

  const archived = lifecycleDeps(card({ status: "archived" }));
  assert.deepEqual(await archived.handlers.deleteCard({ cardId: "card_1" }), { deleted: true, error: null });
  assert.ok(
    archived.calls.some(([name, , reason]) => name === "stopOwnedRuns" && reason === "card-deleted"),
    "deleting stops the card's owned native runs too",
  );
});

// A run that will not stop is the refusal: archiving must not claim success
// while a native workflow keeps running against a card the card list calls
// archived.
test("a run that will not stop refuses the archive and the delete", async () => {
  const stuck = lifecycleDeps(card(), { stopOwnedRuns: false });
  assert.deepEqual(
    await stuck.handlers.cancelCard({ cardId: "card_1" }),
    { archived: false },
    "a card whose run will not stop is not archived",
  );
  assert.ok(!stuck.calls.some(([name]) => name === "update"), "the card is not marked archived");
  assert.ok(!stuck.calls.some(([name]) => name === "release"), "claims are not released for a card that is not archived");

  const stuckArchived = lifecycleDeps(card({ status: "archived" }), { stopOwnedRuns: false });
  assert.deepEqual(
    await stuckArchived.handlers.deleteCard({ cardId: "card_1" }),
    { deleted: false, error: "The native workflow could not be stopped; the card was not deleted." },
    "a card whose run will not stop is not deleted, and the refusal says why",
  );
  assert.ok(!stuckArchived.calls.some(([name]) => name === "delete"));
});
