import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureTrackableEventsTable, recordTrackableEvent, listTrackableEvents } from "../lib/trackable-events.mjs";
import { acquireWorkspaceClaims, ensureCardClaimsTables, lapsedScopeClaims } from "../lib/card-claims.mjs";
import { plansRelDir, scopesRelDir, reconReceiptRelPath, isSpecTechFile } from "../lib/tracking-paths.mjs";

// Uniform layout: every derived path hangs off the state dir with fixed
// areas and basenames — one construction rule for plans, scopes, and
// context instead of per-callsite joins.
assert.equal(plansRelDir(".stelow/2026-01-01/abc"), ".stelow/2026-01-01/abc/plans", "plans area resolves");
assert.equal(plansRelDir(null), null, "missing dirs refuse");
assert.equal(scopesRelDir(".stelow/2026-01-01/abc"), ".stelow/2026-01-01/abc/scopes", "scopes area resolves");
assert.equal(reconReceiptRelPath(".stelow/2026-01-01/abc"), ".stelow/2026-01-01/abc/context/recon-receipt.json", "receipt path resolves");
assert.equal(isSpecTechFile("spec-tech_v1.md"), true, "versioned specs match");
assert.equal(isSpecTechFile("spec-product_v1.md"), false, "other plans do not match");
assert.equal(isSpecTechFile(null), false, "junk never matches");

// The trail is append-only with per-card sequences: decisions replay in
// order, junk appends refuse, logging never throws into the workflow.
const db = new Database(":memory:");
ensureTrackableEventsTable(db);
ensureTrackableEventsTable(db);
assert.equal(recordTrackableEvent(db, { cardId: "c1", kind: "scope", trackableId: "all", transition: "execution-entered", actor: "host", evidence: "3 synced scope(s)" }), 1, "first event sequences at 1");
assert.equal(recordTrackableEvent(db, { cardId: "c1", kind: "build", trackableId: "c1", transition: "completed", actor: "host" }), 2, "sequences advance per card");
assert.equal(recordTrackableEvent(db, { cardId: "c2", kind: "scope", trackableId: "all", transition: "execution-refused", actor: "host", evidence: "why" }), 1, "sequences are per card");
assert.equal(recordTrackableEvent(db, { cardId: "c1", kind: "scope" }), null, "incomplete events refuse");
assert.equal(recordTrackableEvent(db, {}), null, "junk refuses");
const trail = listTrackableEvents(db, "c1");
assert.deepEqual(trail.map((event) => [event.seq, event.transition]), [[1, "execution-entered"], [2, "completed"]], "the trail replays oldest first");
assert.equal(trail[0].evidence, "3 synced scope(s)", "evidence travels with the transition");
assert.deepEqual(listTrackableEvents(db, "missing"), [], "unknown cards trail empty");
assert.deepEqual(listTrackableEvents(db, null), [], "junk trails empty");

// Lapsed-claim signal: held-then-expired reads stalled, live reads
// active, never-held reads unknown — the host's only scope-level
// liveness probe without thread file-telemetry.
const claimsDb = new Database(":memory:");
ensureCardClaimsTables(claimsDb);
acquireWorkspaceClaims(claimsDb, { cardId: "c1", workspacePath: "/ws", files: ["src/a.ts"], scope: "scope-1", ttlMs: 1000, nowMs: 1_000 });
assert.equal(lapsedScopeClaims(claimsDb, { cardId: "c1", workspacePath: "/ws", scope: "scope-1", files: ["src/a.ts"], nowMs: 1_500 }), false, "live leases read active");
assert.equal(lapsedScopeClaims(claimsDb, { cardId: "c1", workspacePath: "/ws", scope: "scope-1", files: ["src/a.ts"], nowMs: 5_000 }), true, "expired leases read stalled");
assert.equal(lapsedScopeClaims(claimsDb, { cardId: "c1", workspacePath: "/ws", scope: "scope-2", files: ["src/b.ts"], nowMs: 5_000 }), false, "never-held reads unknown");
assert.equal(lapsedScopeClaims(claimsDb, { cardId: null, workspacePath: "/ws", nowMs: 5_000 }), false, "junk reads unknown");

console.log("tracking test ok: uniform paths, append-only trail");
