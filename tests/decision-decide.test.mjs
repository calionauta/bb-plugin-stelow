import assert from "node:assert/strict";
import { createDecideCommand } from "../server/runtime/cli/cli-decide.ts";
import { parseReceiptFile } from "../lib/decision-receipts.mjs";

function harness() {
  let file = null;
  const comments = [];
  let n = 0;
  const deps = {
    bb: {
      sdk: {
        files: {
          read: async ({ path }) => {
            if (path.endsWith("state.md")) return { content: "---\nshape_version: v7\n---\n" };
            if (file === null) throw new Error("missing");
            return { content: file };
          },
          write: async ({ content }) => {
            file = content;
            return { outcome: "ok" };
          },
        },
      },
    },
    randomId: () => `r-${++n}`,
    getCard: () => ({ id: "card1", dir_hash: "abc", worker_thread_id: "t1" }),
    getCardByWorkerThread: () => ({ id: "card1", dir_hash: "abc", worker_thread_id: "t1" }),
    cardWorkspace: async () => ({ path: "/repo", hostId: null }),
    workflowStateDir: async () => "/state/abc",
    logCardComment: (...args) => {
      comments.push(args);
      return "c1";
    },
  };
  return { deps, comments, get file() {
    return file;
  } };
}

const ctx = { threadId: "t1", projectId: "p1" };

// First decision records, stamps the shape version, and trails a comment.
{
  const h = harness();
  const decide = createDecideCommand(h.deps);
  const out = await decide(["decide", "--selected", "opt-5", "--rejected", "opt-3", "--scopes", "s1"], ctx);
  assert.equal(out.exitCode, 0);
  const receipts = parseReceiptFile(h.file);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].selectedId, "opt-5");
  assert.deepEqual(receipts[0].authorizesVersions, { shape_version: "v7" });
  assert.equal(h.comments.length, 1);
  assert.match(h.comments[0].join(" "), /opt-5/);
}

// Reviving the rejected option without a challenge refuses with the exit.
{
  const h = harness();
  const decide = createDecideCommand(h.deps);
  await decide(["decide", "--selected", "opt-5", "--rejected", "opt-3", "--scopes", "s1"], ctx);
  const out = await decide(["decide", "--selected", "opt-3", "--scopes", "s1"], ctx);
  assert.equal(out.exitCode, 1);
  assert.match(out.stderr, /--challenge r-1/);
  assert.equal(parseReceiptFile(h.file).length, 1);
}

// Naming the challenge records; supersession retires the old receipt.
{
  const h = harness();
  const decide = createDecideCommand(h.deps);
  await decide(["decide", "--selected", "opt-5", "--rejected", "opt-3", "--scopes", "s1"], ctx);
  const out = await decide(
    ["decide", "--selected", "opt-3", "--scopes", "s1", "--challenge", "r-1", "--supersedes", "r-1"],
    ctx,
  );
  assert.equal(out.exitCode, 0);
  const receipts = parseReceiptFile(h.file);
  assert.equal(receipts.length, 2);
  assert.equal(receipts.find((r) => r.id === "r-1").supersededBy, "r-2");
  assert.equal(receipts.find((r) => r.id === "r-2").challengeId, "r-1");
}

// Missing --selected fails with usage, not a write.
{
  const h = harness();
  const decide = createDecideCommand(h.deps);
  const out = await decide(["decide", "--scopes", "s1"], ctx);
  assert.equal(out.exitCode, 1);
  assert.equal(h.file, null);
}

console.log("decision-decide: ok");
