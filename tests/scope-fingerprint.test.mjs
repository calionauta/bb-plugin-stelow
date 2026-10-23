import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { scopeFingerprint } from "../lib/scope-fingerprint.mjs";
import { ensureCardClaimsTables } from "../lib/card-claims.mjs";
import { createScopeProgressSync } from "../server/scope-progress-sync.ts";
import { startReconciler } from "../server/runtime/reconciler.ts";

// The fingerprint moves exactly when progress moves: scope or task status
// flips change it; renames, notes, and junk never wake the board. The
// reconcile loop publishes card-state on movement, so silent worker edits
// surface within one tick instead of whenever the next host action reloads.
const scopes = [
  { id: "s1", name: "Checkout", status: "done", tasks: [{ id: "t1", name: "Pay", status: "done" }] },
  { id: "s2", name: "Refunds", status: "pending", tasks: [{ id: "t2", name: "List", status: "pending" }] },
];
const base = scopeFingerprint(scopes);
assert.ok(base.length > 0, "a tracked board hashes to a nonempty print");

const advanced = structuredClone(scopes);
advanced[1].status = "in-progress";
assert.notEqual(scopeFingerprint(advanced), base, "a scope status flip moves the print");

const tasked = structuredClone(scopes);
tasked[1].tasks[0].status = "done";
assert.notEqual(scopeFingerprint(tasked), base, "a task status flip moves the print");

const renamed = structuredClone(scopes);
renamed[1].name = "Refunds v2";
renamed[1].tasks[0].note = "remember this";
assert.equal(scopeFingerprint(renamed), base, "renames and notes never wake the board");

assert.equal(scopeFingerprint([]), "", "no scopes hashes empty");
assert.equal(scopeFingerprint(null), "", "junk hashes empty, never throws");
assert.equal(scopeFingerprint([{ id: "s1" }]), scopeFingerprint([{ id: "s1" }]), "missing statuses hash stably");

console.log("scope fingerprint test ok: progress moves it, cosmetics do not");

// The reconcile loop watches prints per live card and publishes card-state only
// on movement — first sight baselines silently, dead cards prune out, and a
// pruned card re-baselines rather than reporting a phantom move. Driven through
// the real modules: a rename of the watch's internals, a first sync that
// published, or a prune that leaked all fail here because the CALLS are
// observed, not the source.

function progressFixture() {
  const root = mkdtempSync(join(tmpdir(), "stelow-scope-progress-"));
  const tracking = {
    workflows: [{ workflowId: "card_1", scopes: [{ id: "s1", status: "pending" }] }],
  };
  writeFileSync(join(root, "stelow.json"), JSON.stringify(tracking));
  const writes = [];
  const progress = createScopeProgressSync({
    getCard: (id) => (id === "card_1" ? { id } : undefined),
    cardWorkspace: async () => ({ path: root }),
    publish: (id) => writes.push(id),
  });
  const advance = (status) => {
    tracking.workflows[0].scopes[0].status = status;
    writeFileSync(join(root, "stelow.json"), JSON.stringify(tracking));
  };
  return { root, writes, progress, advance };
}

test("the progress watch baselines silently, publishes on movement, and prunes", async () => {
  const f = progressFixture();
  try {
    await f.progress.sync("card_1");
    await f.progress.sync("card_1");
    assert.deepEqual(f.writes, [], "the first print is a silent baseline");

    f.advance("in-progress");
    await f.progress.sync("card_1");
    assert.deepEqual(f.writes, ["card_1"], "a moved print publishes card-state");

    // A pruned card is no longer watched, so its next sync is a fresh baseline
    // rather than a movement — the map cannot outgrow the live set.
    f.progress.prune(new Set());
    await f.progress.sync("card_1");
    assert.deepEqual(f.writes, ["card_1"], "a re-baselined card does not report a move");

    f.advance("done");
    await f.progress.sync("card_1");
    assert.deepEqual(f.writes, ["card_1", "card_1"], "the watch still publishes after pruning");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

function reconcilerDb() {
  const db = new Database(":memory:");
  // `activity` is here for the claims pass: a renewal is gated on the host not
  // having given up on the card, and the fixture has to carry the column the
  // real table carries or every tick reports a missing column.
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, status TEXT, worker_thread_id TEXT, activity TEXT)");
  db.exec(`CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
    summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
    occurred_at INTEGER NOT NULL, read_at INTEGER, archived_at INTEGER,
    resolved_at INTEGER, resolved_reason TEXT, severity INTEGER,
    severity_reasons TEXT, occurrences INTEGER
  )`);
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run("live_a", "in-progress", "thread-1", "running");
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run("live_b", "in-progress", "thread-2", "idle");
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run("unstarted", "draft", null, "idle");
  ensureCardClaimsTables(db);
  return db;
}

test("every reconcile tick watches every live card and prunes the dead ones", () => {
  const db = reconcilerDb();
  const scopes = [];
  const pruned = [];
  const reconciler = startReconciler({
    db,
    now: () => 10_000,
    syncThreadState: async () => {},
    scopeProgress: {
      sync: async (id) => { scopes.push(id); },
      prune: (ids) => { pruned.push([...ids].sort()); },
    },
    maybeBumpSeverity: async () => {},
    notifyClaimWaiters: async () => {},
    onError: (phase, error) => { throw new Error(`${phase}: ${error}`); },
    scheduler: { setInterval: () => 1, clearInterval: () => {} },
  });
  try {
    reconciler.tick();
    assert.deepEqual(scopes, ["live_a", "live_b"], "each live card is watched every tick");
    assert.deepEqual(pruned, [["live_a", "live_b"]], "the live set is the prune input, so dead cards drop out");
  } finally {
    reconciler.dispose();
    db.close();
  }
});
