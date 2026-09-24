import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { commentFingerprint, toMirrorRows } from "../lib/github-issue-comments.mjs";

// Comment mirror: read-only, append-only, identity by fingerprint (the github
// plugin type carries no comment ids). Mirrored rows must never flow back
// out — no write path exists in this module by construction.

// Fingerprints are stable per content and distinct per field.
const base = { author: "octocat", createdAt: "2026-09-22T10:00:00Z", body: "Keep it." };
assert.equal(commentFingerprint(base), commentFingerprint({ ...base }), "same content fingerprints stable");
assert.notEqual(commentFingerprint(base), commentFingerprint({ ...base, body: "Drop it." }), "body edits fingerprint distinctly");
assert.notEqual(commentFingerprint(base), commentFingerprint({ ...base, author: "you" }), "author edits fingerprint distinctly");
assert.match(commentFingerprint(base), /^[0-9a-f]{64}$/, "fingerprints are hex sha256");

// Row mapping carries every field the section renders; an unparseable date
// falls back to fetch time instead of storing NaN.
const rows = toMirrorRows("card_1", [
  { author: "octocat", createdAt: "2026-09-22T10:00:00Z", body: "First." },
  { author: "you", createdAt: "not-a-date", body: "Second." },
], 9_999);
assert.equal(rows.length, 2, "every comment maps one row");
assert.equal(rows[0].id, commentFingerprint({ author: "octocat", createdAt: "2026-09-22T10:00:00Z", body: "First." }), "row id is the fingerprint");
assert.equal(rows[0].created_at, Date.parse("2026-09-22T10:00:00Z"), "valid dates pass through");
assert.equal(rows[1].created_at, 9999, "bad dates fall back to fetch time");
assert.deepEqual(toMirrorRows("card_1", null, 1), [], "a missing comment list maps empty, never throws");

// Storage dedupes on the fingerprint primary key: re-fetching the same
// thread converges instead of duplicating, which is what makes the 5-minute
// poll safe to run blind.
const db = new Database(":memory:");
db.exec(`CREATE TABLE github_issue_comments (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL, author TEXT NOT NULL,
  body TEXT NOT NULL, created_at INTEGER NOT NULL, fetched_at INTEGER NOT NULL
)`);
const insert = db.prepare("INSERT OR IGNORE INTO github_issue_comments (id, card_id, author, body, created_at, fetched_at) VALUES (?,?,?,?,?,?)");
const run = (list) => list.reduce((total, row) => total + insert.run(row.id, row.card_id, row.author, row.body, row.created_at, row.fetched_at).changes, 0);
assert.equal(run(rows), 2, "first fetch inserts");
assert.equal(run(toMirrorRows("card_1", [{ author: "octocat", createdAt: "2026-09-22T10:00:00Z", body: "First." }], 10_001)), 0, "re-fetch inserts nothing");
assert.equal(run(toMirrorRows("card_1", [{ author: "octocat", createdAt: "2026-09-22T11:00:00Z", body: "Third." }], 10_002)), 1, "a new comment inserts once");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM github_issue_comments").get().n, 3, "the mirror holds exactly the thread");

// Wiring: the discussion RPC exists in contract and handlers, the modular
// card detail component fetches it on open, and the section only renders for
// linked cards.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = readFileSync(join(root, "server/github-issues.ts"), "utf8");
const discussion = readFileSync(join(root, "components/github/github-linked-discussion.tsx"), "utf8");
assert.match(contract, /getLinkedDiscussion: \{/, "the discussion RPC is contracted");
assert.match(contract, /async getLinkedDiscussion\(\{ cardId/, "the discussion RPC is implemented");
assert.match(discussion, /rpc\.call\("getLinkedDiscussion"/, "card detail fetches the mirror on open");
assert.match(discussion, /Linked discussion/, "the section names itself");
assert.match(contract, /postIssueComment: \{/, "the post RPC is contracted");
assert.match(contract, /async postIssueComment\(\{ cardId, body/, "the post RPC is implemented");
assert.match(contract, /canCreate: z\.boolean\(\),\n\s+repos: z\.array\(z\.string\(\)\)/, "eligibility travels with the mirror");
assert.match(discussion, /rpc\.call\("postIssueComment"/, "the composer posts through the RPC");
assert.match(discussion, /Write to the issue/, "the composer names its target");
assert.match(discussion, /public and hard to undo/, "the confirm states the blast radius");
assert.match(discussion, /No linked issue yet/, "the unlinked state offers creation");

console.log("github issue comments test ok: fingerprint, mapping, dedupe storage, wiring");
