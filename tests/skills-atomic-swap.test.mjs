import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitBlobSha, syncWorkflowSkills } from "../lib/workflow-skills-sync.mjs";

// Offline fixture: stubbed GitHub (tree + raw blobs) so the atomic publish
// is exercised deterministically — no network, no skip path.
const nextRef = (() => {
  let n = 0;
  // The module caches trees per ref for 60s, so every sync-after-mutation
  // needs a fresh ref to see the new fixture.
  return () => String(n++).padStart(40, "0");
})();
const blobs = new Map(); // "skill/rel" -> Buffer
const failures = new Map(); // "skill/rel" -> HTTP status to force
let slowRelease = null;

function treeBlobs() {
  return [...blobs.keys()].map((key) => {
    const slash = key.indexOf("/");
    return { path: `skills/${key}`, sha: gitBlobSha(blobs.get(key)), type: "blob", skill: key.slice(0, slash), rel: key.slice(slash + 1) };
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const text = String(url);
  if (text.includes("api.github.com")) {
    return { ok: true, json: async () => ({ tree: treeBlobs(), truncated: false }) };
  }
  const match = text.match(/\/[^/]+\/(skills\/.+)$/);
  const key = match ? match[1].slice("skills/".length) : "";
  if (failures.has(key)) return { ok: false, status: failures.get(key) };
  if (slowRelease && key === slowRelease.key) await slowRelease.promise;
  if (!blobs.has(key)) return { ok: false, status: 404 };
  const content = blobs.get(key);
  return { ok: true, arrayBuffer: async () => content };
};

function freshRoot() {
  const root = mkdtempSync(join(tmpdir(), "stelow-atomic-test-"));
  return { root, target: join(root, "skills"), state: join(root, ".sync-state.json") };
}

try {
  // Seed fixture: two skills, one with an executable helper script.
  blobs.set("stelow-a/SKILL.md", Buffer.from("# A\n"));
  blobs.set("stelow-a/run.sh", Buffer.from("echo old\n"));
  blobs.set("stelow-a/docs/guide.md", Buffer.from("guide v1\n"));
  blobs.set("stelow-b/SKILL.md", Buffer.from("# B\n"));

  // First sync creates everything; no staging litter or dotfiles remain.
  {
    const { root, target, state } = freshRoot();
    try {
      const first = await syncWorkflowSkills(target, { ref: nextRef(), log: () => {}, statePath: state });
      assert.equal(first.errors.length, 0, "first sync is clean");
      assert.ok(first.created.length === 4, "first sync creates all files");
      assert.ok(existsSync(join(target, "stelow-a", "run.sh")), "script lands in place");
      const strays = readdirSync(target).filter((e) => e.startsWith("."));
      assert.deepEqual(strays, [], "no dotfiles inside skills/");
      const litter = readdirSync(root).filter((e) => e.includes(".staging."));
      assert.deepEqual(litter, [], "no staging dirs left beside skills/");
      // Second run is a no-op.
      const second = await syncWorkflowSkills(target, { ref: nextRef(), log: () => {}, statePath: state });
      assert.equal(second.changed, false, "second run is a no-op");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // Atomicity: while one download hangs, the live tree still serves the
  // complete old version — readers never see a half-written skill.
  {
    const { root, target, state } = freshRoot();
    try {
      await syncWorkflowSkills(target, { ref: nextRef(), log: () => {}, statePath: state });
      blobs.set("stelow-a/docs/guide.md", Buffer.from("guide v2\n"));
      let release;
      slowRelease = { key: "stelow-a/docs/guide.md", promise: new Promise((r) => { release = r; }) };
      const pending = syncWorkflowSkills(target, { ref: nextRef(), log: () => {}, statePath: state });
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(
        readFileSync(join(target, "stelow-a", "docs", "guide.md"), "utf8"),
        "guide v1\n",
        "live tree still serves the old version mid-sync",
      );
      assert.equal(readFileSync(join(target, "stelow-a", "SKILL.md"), "utf8"), "# A\n", "sibling files untouched mid-sync");
      release();
      const done = await pending;
      assert.equal(done.errors.length, 0, "stalled sync completes clean");
      assert.equal(readFileSync(join(target, "stelow-a", "docs", "guide.md"), "utf8"), "guide v2\n", "swap publishes the new version");
      slowRelease = null;
    } finally {
      slowRelease = null;
      rmSync(root, { recursive: true, force: true });
    }
  }

  // Mode preservation + failed-download carry-over + retired-file reporting.
  {
    const { root, target, state } = freshRoot();
    try {
      await syncWorkflowSkills(target, { ref: nextRef(), log: () => {}, statePath: state });
      chmodSync(join(target, "stelow-a", "run.sh"), 0o755);
      blobs.set("stelow-a/run.sh", Buffer.from("echo new\n"));
      blobs.set("stelow-a/docs/guide.md", Buffer.from("guide v3\n"));
      failures.set("stelow-a/docs/guide.md", 500);
      writeFileSync(join(target, "stelow-a", "retired.md"), "gone upstream\n");
      mkdirSync(join(target, "notes"), { recursive: true });
      writeFileSync(join(target, "notes", "x.md"), "foreign\n");
      const run = await syncWorkflowSkills(target, { ref: nextRef(), log: () => {}, statePath: state });
      assert.equal(readFileSync(join(target, "stelow-a", "run.sh"), "utf8"), "echo new\n", "changed script updates");
      assert.equal(statSync(join(target, "stelow-a", "run.sh")).mode & 0o777, 0o755, "live +x survives the update");
      assert.equal(readFileSync(join(target, "stelow-a", "docs", "guide.md"), "utf8"), "guide v2\n", "failed download keeps the live file");
      assert.ok(!existsSync(join(target, "stelow-a", "retired.md")), "retired file vanishes via the swap");
      assert.ok(run.removed.includes("stelow-a/retired.md"), "retired file reported");
      assert.ok(existsSync(join(target, "notes", "x.md")), "non-stelow entries untouched");
      assert.equal(run.errors.length, 1, "one error reported");
      // Next run retries the failed file instead of pinning the gap.
      failures.delete("stelow-a/docs/guide.md");
      const retry = await syncWorkflowSkills(target, { ref: nextRef(), log: () => {}, statePath: state });
      assert.equal(retry.errors.length, 0, "retry is clean");
      assert.equal(readFileSync(join(target, "stelow-a", "docs", "guide.md"), "utf8"), "guide v3\n", "retry publishes the file");
    } finally {
      failures.clear();
      rmSync(root, { recursive: true, force: true });
    }
  }

  console.log("skills-atomic-swap test ok: atomic publish, mode preservation, failure carry-over");
} finally {
  globalThis.fetch = realFetch;
}
