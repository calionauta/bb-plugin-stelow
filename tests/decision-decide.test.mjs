import assert from "node:assert/strict";
import { createDecideCommand } from "../server/runtime/cli/cli-decide.ts";
import { parseReceiptFile, parseReceiptStore } from "../lib/decision-receipts.mjs";

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
    randomId: (prefix) => `${prefix}-${++n}`,
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
  const out = await decide(["decide", "--selected", "opt-5", "--rejected", "opt-3", "--scopes", "s1", "--by", "ana"], ctx);
  assert.equal(out.exitCode, 0);
  const receipts = parseReceiptFile(h.file);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].selectedId, "opt-5");
  assert.equal(receipts[0].approvedBy, "ana");
  assert.deepEqual(receipts[0].authorizesVersions, { shape_version: "v7" });
  assert.equal(h.comments.length, 1);
  assert.match(h.comments[0].join(" "), /opt-5/);
}

// Reviving the rejected option without a challenge refuses with the two verbs.
{
  const h = harness();
  const decide = createDecideCommand(h.deps);
  await decide(["decide", "--selected", "opt-5", "--rejected", "opt-3", "--scopes", "s1"], ctx);
  const out = await decide(["decide", "--selected", "opt-3", "--scopes", "s1"], ctx);
  assert.equal(out.exitCode, 1);
  assert.match(out.stderr, /--open-challenge --against dec-1/);
  assert.equal(parseReceiptFile(h.file).length, 1);
}

// A claimed-but-unregistered challenge is still a refusal: names, not claims.
{
  const h = harness();
  const decide = createDecideCommand(h.deps);
  await decide(["decide", "--selected", "opt-5", "--rejected", "opt-3", "--scopes", "s1"], ctx);
  const out = await decide(["decide", "--selected", "opt-3", "--scopes", "s1", "--challenge", "ch-ghost"], ctx);
  assert.equal(out.exitCode, 1);
  assert.equal(parseReceiptFile(h.file).length, 1);
}

// Open the challenge, then the contradicted pick records with the chain.
{
  const h = harness();
  const decide = createDecideCommand(h.deps);
  await decide(["decide", "--selected", "opt-5", "--rejected", "opt-3", "--scopes", "s1"], ctx);
  const opened = await decide(["decide", "--open-challenge", "--against", "dec-1", "--reason", "cost changed"], ctx);
  assert.equal(opened.exitCode, 0);
  assert.match(opened.stdout, /chg-2/);
  const out = await decide(
    ["decide", "--selected", "opt-3", "--scopes", "s1", "--challenge", "chg-2", "--supersedes", "dec-1"],
    ctx,
  );
  assert.equal(out.exitCode, 0);
  const store = parseReceiptStore(h.file);
  assert.equal(store.receipts.length, 2);
  assert.equal(store.receipts.find((r) => r.id === "dec-1").supersededBy, "dec-3");
  assert.equal(store.receipts.find((r) => r.id === "dec-3").challengeId, "chg-2");
}

// Challenges against unknown or dead receipts refuse.
{
  const h = harness();
  const decide = createDecideCommand(h.deps);
  assert.equal((await decide(["decide", "--open-challenge", "--against", "ghost", "--reason", "x"], ctx)).exitCode, 1);
  assert.equal((await decide(["decide", "--open-challenge", "--against", "dec-1"], ctx)).exitCode, 1);
}

// A contradicting record (challenge opened, old receipt kept live) warns
// on stdout and trails the conflict where the decision lives.
{
  const h = harness();
  const decide = createDecideCommand(h.deps);
  await decide(["decide", "--selected", "opt-5", "--rejected", "opt-3", "--scopes", "s1"], ctx);
  await decide(["decide", "--open-challenge", "--against", "dec-1", "--reason", "cost changed"], ctx);
  const out = await decide(["decide", "--selected", "opt-3", "--scopes", "s1", "--challenge", "chg-2"], ctx);
  assert.equal(out.exitCode, 0);
  assert.match(out.stdout, /contradicts live decision.*dec-1 vs dec-3/);
  assert.match(h.comments[h.comments.length - 1].join(" "), /Decision conflict: dec-1 vs dec-3/);
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
