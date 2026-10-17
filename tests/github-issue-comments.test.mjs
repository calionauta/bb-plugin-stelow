import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement as h } from "react";
import Database from "better-sqlite3";
import { commentFingerprint, toMirrorRows } from "../lib/github-issue-comments.mjs";
import { githubRpcContract } from "../server/github-rpc-contract.ts";
import { githubCommentHandlers } from "../server/github-comments.ts";

// Comment mirror: read-only, append-only, identity by fingerprint (the github
// plugin type carries no comment ids). Mirrored rows must never flow back
// out — no write path exists in this module by construction.
//
// SCOPE7: the wiring that used to be a regex over `github-rpc-contract.ts`,
// `github-comments.ts` and `github-linked-discussion.tsx` is asked of the real
// modules here — the contract parses (and refuses) real snapshots, the
// handlers run against a real sqlite database, and the section is RENDERED
// with its rpc stubbed so the fetch, the composer and the confirmation are
// behaviours, not strings in a file.

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

// Contract: the discussion RPCs are contracted, and the shape carries the
// eligibility the section renders — a snapshot without canCreate/repos is
// refused where it is produced, so the section cannot read an undefined.
const discussion = githubRpcContract.getLinkedDiscussion;
assert.equal(typeof discussion.experimental_description, "string", "the discussion RPC is contracted and discoverable");
const linkedSnapshot = {
  linked: true, repo: "octo/a", number: 7, url: "https://github.com/octo/a/issues/7",
  comments: [{ author: "octocat", body: "First.", createdAt: 1 }], updatedAt: 1,
  canCreate: false, repos: [],
};
assert.deepEqual(discussion.output.parse(linkedSnapshot), linkedSnapshot, "a real mirror snapshot parses");
const { canCreate: _canCreate, repos: _repos, ...withoutEligibility } = linkedSnapshot;
assert.throws(() => discussion.output.parse(withoutEligibility), /canCreate|repos/, "eligibility travels with the mirror");
assert.throws(() => discussion.input.parse({}), "the RPC is addressed by a card id");
assert.throws(
  () => githubRpcContract.postIssueComment.input.parse({ cardId: "card_1", body: "" }),
  "an empty post never reaches GitHub",
);

// The slice is wired to the contract names, driven: the handlers below run the
// real SQL against a real database, so a handler declared and forgotten behind
// the contract fails here rather than passing on its own name in a file.
const mirror = new Database(":memory:");
mirror.exec(`
  CREATE TABLE cards (id TEXT PRIMARY KEY, status TEXT NOT NULL, project_id TEXT NOT NULL);
  CREATE TABLE github_imports (card_id TEXT, repo TEXT, number INTEGER);
  CREATE TABLE github_issue_comments (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, author TEXT NOT NULL,
    body TEXT NOT NULL, created_at INTEGER NOT NULL, fetched_at INTEGER NOT NULL
  );
`);
mirror.prepare("INSERT INTO cards (id, status, project_id) VALUES (?, ?, ?)").run("card_1", "active", "project_1");
mirror.prepare("INSERT INTO cards (id, status, project_id) VALUES (?, ?, ?)").run("card_archived", "archived", "project_1");
mirror.prepare("INSERT INTO github_imports (card_id, repo, number) VALUES (?, ?, ?)").run("card_1", "octo/a", 7);
const published = [];
const posted = [];
const client = {
  getIssue: async () => ({ issue: { comments: [
    { author: "octocat", createdAt: "2026-09-22T10:00:00Z", body: "First." },
  ] } }),
  commentIssue: async (args) => { posted.push(args); return { ok: true }; },
  statusResolved: async () => ({ ghOk: true, repos: [{ repo: "octo/a", projectId: "project_1" }] }),
};
const ctx = {
  db: mirror,
  now: () => 5_000,
  bb: { realtime: { publish: (channel, payload) => published.push([channel, payload]) }, log: { warn: () => {} } },
  cards: { cardStatusOf: (status) => (status === "active" ? "in-progress" : status) },
};
const handlers = githubCommentHandlers(ctx, client);

const read = await handlers.getLinkedDiscussion({ cardId: "card_1" });
assert.equal(read.linked, true, "a linked card reads its issue back");
assert.equal(read.repo, "octo/a", "the linked repo travels with the mirror");
assert.equal(read.number, 7, "and the issue number");
assert.equal(read.url, "https://github.com/octo/a/issues/7", "the section's link is derived, not stored");
assert.deepEqual(
  read.comments,
  [{ author: "octocat", body: "First.", createdAt: Date.parse("2026-09-22T10:00:00Z") }],
  "the fetched thread is mirrored and read back",
);
assert.deepEqual(published, [["github-discussion", { cardId: "card_1" }]], "a grown mirror republishes the channel the section listens on");

const unlinked = await handlers.getLinkedDiscussion({ cardId: "card_2" });
assert.equal(unlinked.linked, false, "an unknown card is unlinked, never an error");
assert.equal(unlinked.canCreate, false, "with no card there is nothing to create in");
assert.deepEqual(unlinked.repos, [], "and no repo is offered");

mirror.prepare("INSERT INTO cards (id, status, project_id) VALUES (?, ?, ?)").run("card_unlinked", "active", "project_1");
const eligible = await handlers.getLinkedDiscussion({ cardId: "card_unlinked" });
assert.equal(eligible.linked, false, "a mapped, unlinked card is the create-affordance shape");
assert.equal(eligible.canCreate, true, "the mapped repo makes creation possible");
assert.deepEqual(eligible.repos, ["octo/a"], "and the mapped repo is what it offers");

assert.equal((await handlers.getLinkedDiscussion({ cardId: "card_archived" })).canCreate, false, "an archived card is never offered creation");

assert.deepEqual(await handlers.postIssueComment({ cardId: "card_1", body: "  Ship it.  " }), { ok: true, error: null }, "a human post reaches GitHub");
assert.deepEqual(posted, [{ repo: "octo/a", number: 7, body: "Ship it." }], "the post is trimmed and addressed to the linked issue");
assert.equal((await handlers.postIssueComment({ cardId: "card_1", body: "   " })).ok, false, "a blank post is refused payload-side");
assert.equal((await handlers.postIssueComment({ cardId: "card_2", body: "hi" })).ok, false, "an unlinked card has nowhere to post");
assert.equal((await handlers.postIssueComment({ cardId: "card_archived", body: "hi" })).ok, false, "an archived card is never posted to");
mirror.close();

// --- the section, rendered -------------------------------------------------
// Harness note: `@get-bb/plugin-sdk/app` snapshots `useRpc`/`UrlLink`/... from
// `globalThis.__bbPluginRuntime` at import time, so the stubs must be installed
// BEFORE the component chain loads — hence the dynamic imports below.
const rpcCalls = [];
let snapshot = linkedSnapshot;
// Stable rpc identity, like the host's: a fresh object per render would
// re-fire the section's load effect for a reason the real app cannot produce.
const rpc = {
  call: async (method, payload) => {
    rpcCalls.push({ method, payload });
    return method === "postIssueComment" ? { ok: true, error: null } : snapshot;
  },
};
globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => rpc,
    useRealtime: () => {},
    Markdown: ({ content }) => h("div", null, content),
    UrlLink: ({ href, children }) => h("a", { href }, children),
  },
};
register(pathToFileURL(new URL("./register-tsx.mjs", import.meta.url).pathname), import.meta.url);
await import("./dom-setup.mjs");
const { render, screen, fireEvent, act, cleanup } = await import("@testing-library/react");
const { LinkedDiscussionSection } = await import("../components/github/github-linked-discussion.tsx");

const linked = {
  ...linkedSnapshot,
  comments: [{ author: "octocat", body: "First.", createdAt: Date.parse("2026-09-22T10:00:00Z") }],
};
snapshot = linked;
render(h(LinkedDiscussionSection, { cardId: "card_1" }));
await act(async () => {});
assert.deepEqual(rpcCalls[0], { method: "getLinkedDiscussion", payload: { cardId: "card_1" } }, "the card detail fetches the mirror on open");
assert.ok(screen.getByText("Linked discussion"), "the section names itself");
assert.ok(screen.getByText("octocat"), "the mirrored comment renders");
assert.ok(screen.getByText("Write to the issue"), "the composer names its target");

fireEvent.change(screen.getByRole("textbox"), { target: { value: "Looks right." } });
fireEvent.click(screen.getByText("Post to issue"));
assert.ok(screen.getByText(/public and hard to undo/), "the confirm states the blast radius");
await act(async () => { fireEvent.click(screen.getByText("Confirm post")); });
assert.deepEqual(
  rpcCalls.filter((call) => call.method === "postIssueComment"),
  [{ method: "postIssueComment", payload: { cardId: "card_1", body: "Looks right." } }],
  "the composer posts through the RPC, exactly once",
);
assert.deepEqual(rpcCalls.at(-1), { method: "getLinkedDiscussion", payload: { cardId: "card_1" } }, "and the mirror reloads after a post");
cleanup();

snapshot = { linked: false, repo: null, number: null, url: null, comments: [], updatedAt: null, canCreate: true, repos: ["octo/a"] };
render(h(LinkedDiscussionSection, { cardId: "card_2" }));
await act(async () => {});
assert.ok(screen.getByText(/No linked issue yet/), "the unlinked state offers creation");
assert.ok(screen.getByRole("button", { name: "Create issue in octo/a" }), "and names where the issue would go");
cleanup();

console.log("github issue comments test ok: fingerprint, mapping, dedupe storage, driven slice, contracted shape, rendered section");
