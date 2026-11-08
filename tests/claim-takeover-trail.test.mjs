import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureCardClaimsTables } from "../lib/card-claims.mjs";
import { acquireScopeClaims } from "../lib/scope-claims.mjs";
import { runScopeCommand } from "../server/scopes.ts";

// A claim takeover, seen from the CLI that performs it.
//
// A lapsed lease is takeable on purpose: the TTL is how a crashed worker's
// files free up. What was missing is the record — the scope path overwrote the
// row and returned an ordinary acquisition, so a worker resumed after the TTL
// found the files it had claimed already held by someone else and the card
// carried no trace of the handover. This file owns that end-to-end path, from
// the gate's result to the comment the card ends up showing; the rest of the
// scope-batch wiring lives in `scope-batch-wiring.test.mjs`.

// A takeover is trailed on the card. A lapsed lease is takeable on purpose —
// the TTL is how a crashed worker's files free up — but it is news to the card
// that lost the file, and the scope path used to overwrite the row and say
// nothing, so a worker resumed after the TTL found its files already held with
// no record of the handover anywhere.
{
  const dir = mkdtempSync(join(tmpdir(), "stelow-steal-"));
  const card = { id: "card-9", dir_hash: null };
  writeFileSync(join(dir, "stelow.json"), JSON.stringify({
    workflows: [{
      workflowId: "card-9",
      scopes: [
        { id: "scope-own", status: "in-progress", targetFiles: ["src/own.ts"] },
        { id: "scope-take", status: "pending", targetFiles: ["src/taken.ts"] },
      ],
    }],
  }));
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const now = Date.now();
  // The start gate is dormant unless the card already runs a batch, so this
  // card holds one claim of its own.
  acquireScopeClaims(db, {
    cardId: "card-9", batchId: "batch-9", scopeId: "scope-own",
    files: ["src/own.ts"], effectiveCheckout: dir, nowMs: now,
  });
  // And its second scope's file was left behind by another card whose lease
  // ran out an hour ago.
  db.prepare(
    "INSERT INTO card_claims (workspace_path, file_path, card_id, scope, acquired_at, expires_at, fencing) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(dir, "src/taken.ts", "card-other", "batch-x::scope-x", now - 120_000, now - 60_000, 3);
  const comments = [];
  const deps = {
    bb: { realtime: { publish: () => undefined } },
    getCardByWorkerThread: () => card,
    cardWorkspace: async () => ({ path: dir }),
    projectRoot: async () => dir,
    workflowStateDir: async () => null,
    ensureProjectArtifacts: async () => null,
    runHelper: async () => ({ code: 0, stdout: "ok", stderr: "" }),
    recordTrackableEvent: () => undefined,
    db,
    logCardComment: (cardId, target, targetId, author, body) => {
      comments.push({ cardId, target, targetId, author, body });
      return "cmt-steal";
    },
  };
  const started = await runScopeCommand(["scope", "start", "--scope", "scope-take"], { threadId: "t-9" }, deps);
  assert.equal(started.exitCode, 0, "a lapsed lease is takeable, so the start proceeds");
  assert.equal(comments.length, 1, "the takeover leaves exactly one trail comment");
  assert.equal(comments[0].cardId, "card-9", "the trail lands on the card that took the file");
  assert.equal(comments[0].author, "agent", "it is the agent's record, not the user's");
  assert.match(comments[0].body, /card-other::batch-x::scope-x/, "the trail names the holder that lapsed");
  assert.match(comments[0].body, /src\/taken\.ts/, "and the file it was taken from");
  const holder = db.prepare("SELECT card_id, scope FROM card_claims WHERE file_path = 'src/taken.ts'").get();
  assert.equal(holder.card_id, "card-9", "the takeover actually moved the row");
  assert.equal(holder.scope, "batch-9::scope-take", "to the starting scope's tag");
}

console.log("claim-takeover-trail: ok");
