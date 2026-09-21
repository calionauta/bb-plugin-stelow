import assert from "node:assert/strict";
import { scopeFingerprint } from "../lib/scope-fingerprint.mjs";

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

// Server wiring: the reconcile loop watches prints per live card and
// publishes card-state only on movement — first sight baselines silently,
// dead cards prune out, and the map cannot outgrow the live set.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
assert.match(server, /const scopePrints = new Map<string, string>\(\);/, "one print per live card, closure lifetime");
assert.match(server, /async function syncScopeProgress\(cardId: string\)/, "the watch is one named helper");
assert.match(server, /for \(const row of rows\) void syncScopeProgress\(row\.id\);/, "every reconcile tick watches every live card");
assert.match(server, /if \(prev !== undefined && prev !== print\) bb\.realtime\.publish\("card-state", \{ cardId \}\);/, "movement publishes, first sight stays silent");
assert.match(server, /for \(const id of scopePrints\.keys\(\)\) if \(!liveIds\.has\(id\)\) scopePrints\.delete\(id\);/, "dead cards prune out of the map");
