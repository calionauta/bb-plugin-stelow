import assert from "node:assert/strict";
import test from "node:test";
import { createWorktreeCleanup } from "../server/worktree-cleanup.ts";

function evidence(overrides = {}) {
  return {
    status: "in-progress",
    workspaceKind: "project",
    checkoutPath: "/tmp/worktree",
    dirExists: true,
    isGit: true,
    branch: "card/cleanup",
    hasUpstream: true,
    upstreamRef: "origin/card/cleanup",
    // The gate requires a positive proof that the work is integrated, so a
    // fixture claiming a clean pushed branch is not enough: it says the merge
    // was recorded. This mirrors what the CLI passes for a card whose pull
    // request the panel recorded as merged.
    remoteMerged: true,
    changed: [],
    untracked: [],
    unpushedCommits: 0,
    stashCount: 0,
    resetTarget: "base",
    linkedWorktree: true,
    sharedWith: 0,
    ...overrides,
  };
}

test("worktree cleanup previews blast radius and removes only after confirmation", async () => {
  const events = [];
  const cleanup = createWorktreeCleanup({
    getCard: (id) => id === "card-1" ? { id, worker_thread_id: "thread-1" } : undefined,
    evidence: async () => evidence(),
    dropWorktree: async (path, branch) => events.push(["drop", path, branch]),
    stopWorker: async (threadId) => events.push(["stop", threadId]),
    log: (cardId, body) => events.push(["comment", cardId, body]),
    publish: (name, payload) => events.push([name, payload.cardId]),
  });

  const preview = await cleanup.handlers.cleanupWorktreePreview({ cardId: "card-1" });
  assert.equal(preview.eligible, true);
  assert.equal(preview.fileCount, 0);
  assert.equal(preview.commitCount, 0);
  assert.match(preview.confirmBody, /destroys unpushed work/);
  assert.deepEqual(events, []);

  const result = await cleanup.handlers.cleanupWorktree({ cardId: "card-1" });
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.match(result.summary, /Card kept as record/);
  assert.deepEqual(events.map(([name]) => name), ["stop", "drop", "comment", "card-state", "board-changed"]);
});

test("worktree cleanup refuses shared checktrees before stopping a worker", async () => {
  let stopped = false;
  const cleanup = createWorktreeCleanup({
    getCard: () => ({ id: "card-2", worker_thread_id: "thread-2" }),
    evidence: async () => evidence({ sharedWith: 1 }),
    dropWorktree: async () => assert.fail("must not remove a shared checkout"),
    stopWorker: async () => { stopped = true; },
    log: () => assert.fail("must not log success"),
    publish: () => assert.fail("must not publish success"),
  });

  const result = await cleanup.handlers.cleanupWorktree({ cardId: "card-2" });
  assert.equal(result.ok, false);
  assert.match(result.error, /share this checkout/);
  assert.equal(stopped, false);
});

test("a card at Done whose work was never merged keeps its worktree", async () => {
  // card_cbnihg4c: 963 lines across 20 files, committed on a branch nobody
  // merged, inside a 269M worktree. Reaching Done is not the same as the work
  // being anywhere a human can get it back from, and `worktree remove --force`
  // would take the only copy with it.
  let dropped = false;
  let stopped = false;
  const cleanup = createWorktreeCleanup({
    getCard: () => ({ id: "card-3", worker_thread_id: "thread-3" }),
    evidence: async () => evidence({
      status: "completed",
      hasUpstream: false,
      upstreamRef: null,
      unpushedCommits: 2,
      // Nothing recorded this card's work ever reaching the base, and its
      // branch differs from it. Both proofs absent is the definition of
      // "the only copy is this directory".
      remoteMerged: false,
      treeMatchesBase: false,
    }),
    dropWorktree: async () => { dropped = true; },
    stopWorker: async () => { stopped = true; },
    log: () => assert.fail("must not log success"),
    publish: () => assert.fail("must not publish success"),
  });

  const preview = await cleanup.handlers.cleanupWorktreePreview({ cardId: "card-3" });
  assert.equal(preview.eligible, false, "Done alone does not make a worktree safe to remove");
  assert.match(preview.reason, /not on the base branch/);
  assert.match(preview.reason, /no recorded merge/);

  const result = await cleanup.handlers.cleanupWorktree({ cardId: "card-3" });
  assert.equal(result.ok, false);
  assert.match(result.error, /not on the base branch/);
  assert.equal(dropped, false, "the worktree must survive");
  assert.equal(stopped, false, "and the worker must not even be stopped");
});
