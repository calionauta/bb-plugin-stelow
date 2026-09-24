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
    hasUpstream: false,
    upstreamRef: null,
    changed: ["src/a.ts"],
    untracked: [],
    unpushedCommits: 1,
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
  assert.equal(preview.fileCount, 1);
  assert.equal(preview.commitCount, 1);
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
