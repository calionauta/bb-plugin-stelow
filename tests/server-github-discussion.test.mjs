/**
 * Behavior tests: the linked-issue discussion and the completion write-back.
 *
 * Each test names the product rule it guards and the change that would break
 * it. Every one is red-able: drop the fingerprint, the marker check, the
 * terminal freeze, or the record-before-close and the named test fails.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { completionBody } from "../server/github-completion.ts";
import { markerFor } from "../lib/github-writeback.mjs";
import { harness, issue, REPO, seedImport } from "./helpers/github-harness.mjs";

test("a linked card's discussion mirrors the issue, deduplicated by fingerprint", async () => {
  const app = harness({ comments: [{ author: "octocat", body: "Same here.", createdAt: "2026-09-20T10:00:00Z" }] });
  seedImport(app.db);

  const first = await app.handlers.getLinkedDiscussion({ cardId: "card-1" });
  assert.equal(first.linked, true);
  assert.equal(first.url, `https://github.com/${REPO}/issues/1`);
  assert.deepEqual(first.comments, [{ author: "octocat", body: "Same here.", createdAt: Date.parse("2026-09-20T10:00:00Z") }]);
  assert.ok(app.state.events.some(([topic]) => topic === "github-discussion"), "a grown mirror announces itself");

  const second = await app.handlers.getLinkedDiscussion({ cardId: "card-1" });
  assert.deepEqual(second.comments, first.comments, "a re-fetch converges instead of duplicating");
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM github_issue_comments").get().n, 1);
  assert.equal(app.state.events.length, 1, "a converged re-fetch does not announce a change that did not happen");
});

test("an edited upstream comment keeps its mirrored body — the snapshot is append-only", async () => {
  const app = harness({ comments: [{ author: "octocat", body: "Same here.", createdAt: "2026-09-20T10:00:00Z" }] });
  seedImport(app.db);
  await app.handlers.getLinkedDiscussion({ cardId: "card-1" });
  app.state.comments = [{ author: "octocat", body: "Fixed by a typo edit.", createdAt: "2026-09-20T10:00:00Z" }];

  const after = await app.handlers.getLinkedDiscussion({ cardId: "card-1" });

  assert.equal(after.comments[0].body, "Same here.", "identity is the content fingerprint, so an edit is a new row, not an overwrite");
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM github_issue_comments").get().n, 2);
});
test("a completed card serves its frozen snapshot and never refetches", async () => {
  const app = harness({ cards: [doneCard()] });
  seedImport(app.db);

  const result = await app.handlers.getLinkedDiscussion({ cardId: "card-1" });

  assert.equal(result.linked, true);
  assert.deepEqual(result.comments, [], "no remote fetch, so no history is rewritten");
});
test("an unlinked card on a mapped project may create its issue, an archived one may not", async () => {
  const linked = harness();
  const eligible = await linked.handlers.getLinkedDiscussion({ cardId: "card-1" });
  assert.equal(eligible.canCreate, true);
  assert.deepEqual(eligible.repos, [REPO]);

  const archived = harness({ cards: [doneCard({ status: "archived" })] });
  const blocked = await archived.handlers.getLinkedDiscussion({ cardId: "card-1" });
  assert.equal(blocked.canCreate, false, "an archived card is history, not a new issue");
});
test("a GitHub outage still answers the discussion instead of emptying the mirror", async () => {
  const app = harness();
  seedImport(app.db);
  app.state.comments = null;
  app.state.failList = "gh: down";
  app.state.items = [];

  const result = await app.handlers.getLinkedDiscussion({ cardId: "card-1" });

  assert.equal(result.linked, true, "the link still reads; only the refresh failed");
  assert.ok(app.state.warned.some((line) => line.includes("linked discussion refresh failed")));
});
test("posting a comment refuses an unlinked card and an archived one before touching GitHub", async () => {
  const unlinked = harness();
  assert.equal((await unlinked.handlers.postIssueComment({ cardId: "card-1", body: "Done." })).error, "This card has no linked GitHub issue.");
  assert.equal(unlinked.state.posted.length, 0);

  const archived = harness({ cards: [doneCard({ status: "archived" })] });
  seedImport(archived.db);
  assert.equal((await archived.handlers.postIssueComment({ cardId: "card-1", body: "Done." })).error, "This card is archived.");
  assert.equal(archived.state.posted.length, 0, "an archived card never posts");
});
test("a posted comment is verified back on the issue and mirrored locally", async () => {
  const app = harness();
  seedImport(app.db);

  const result = await app.handlers.postIssueComment({ cardId: "card-1", body: "Shipped." });

  assert.deepEqual(result, { ok: true, error: null });
  assert.deepEqual(app.state.posted, ["Shipped."]);
  const mirrored = app.db.prepare("SELECT author, body FROM github_issue_comments").all();
  assert.deepEqual(mirrored, [{ author: "you", body: "Shipped." }], "the post reads back instantly");
});
test("a GitHub refusal on a comment is returned, not thrown", async () => {
  const app = harness({ failComment: "gh: 403 forbidden" });
  seedImport(app.db);

  const result = await app.handlers.postIssueComment({ cardId: "card-1", body: "Shipped." });

  assert.equal(result.ok, false);
  assert.match(result.error, /GitHub refused the comment: gh: 403 forbidden/);
});
test("completion write-back refuses a card that was not imported and one that is not done", async () => {
  const unimported = harness();
  const unimportedError = (await unimported.handlers.postGithubCompletion({ cardId: "card-1", closeIssue: false })).error;
  assert.equal(unimportedError, "This card was not imported from a GitHub issue.");

  const running = harness();
  seedImport(running.db);
  assert.equal((await running.handlers.postGithubCompletion({ cardId: "card-1", closeIssue: false })).error, "Only completed cards can report back to GitHub.");
  assert.equal(running.state.posted.length, 0, "a live card never claims the work is done");
});
test("a completed card reports back once, with its scopes, its prompt, and the marker", async () => {
  const app = harness({
    cards: [doneCard({ display_name: "Login 500s", prompt: "It 500s on submit." })],
    scopes: [
      { name: "Backend", status: "done", tasks: [{ status: "done" }, { status: "todo" }] },
      { name: "Docs", status: "active", tasks: [] },
    ],
  });
  seedImport(app.db);
  app.state.comments = [{ author: "you", body: "done", createdAt: "2026-09-21T10:00:00Z" }];

  const result = await app.handlers.postGithubCompletion({ cardId: "card-1", closeIssue: true });

  assert.deepEqual(result, { ok: true, issueUrl: `https://github.com/${REPO}/issues/1`, error: null });
  const body = app.state.posted[0];
  assert.match(body, /^Stelow completed "Login 500s" \(intent: bugfix, final stage: Build\)\./);
  assert.match(body, /Scopes: 1\/2 done; tasks: 1\/2 done\./, "the summary is factual, not celebratory");
  assert.match(body, /- Backend \(done, 1\/2 tasks\)/);
  assert.match(body, /- Docs \(active\)/);
  assert.ok(body.includes(markerFor("card-1")), "the marker is what makes a retry safe");
  assert.deepEqual(app.state.closed, ["closed"], "the optional close runs after the record");
  assert.equal(app.db.prepare("SELECT commented_at FROM github_imports WHERE card_id = 'card-1'").get().commented_at, 1_700_000_000_000);
});
test("a retry after a lost record adopts the existing comment instead of double-posting", async () => {
  const app = harness({ cards: [doneCard()] });
  seedImport(app.db);
  // The comment is already up there; only the local record is missing.
  app.state.comments = [{ author: "you", body: `already posted ${markerFor("card-1")}`, createdAt: "2026-09-21T10:00:00Z" }];

  const result = await app.handlers.postGithubCompletion({ cardId: "card-1", closeIssue: false });

  assert.equal(result.ok, true);
  assert.equal(app.state.posted.length, 0, "the existing comment is adopted, never re-posted");
  assert.equal(commentedAt(app), 1_700_000_000_000, "the record is repaired");
});
test("a post that does not come back on the issue is refused with the next step named", async () => {
  // The fake plugin accepts the comment but never lists it back — the shape
  // of a webhook-less lag. The write-back must not record it as done.
  const app = harness({
    cards: [doneCard()],
    echoPosts: false,
  });
  seedImport(app.db);

  const result = await app.handlers.postGithubCompletion({ cardId: "card-1", closeIssue: false });

  assert.equal(result.ok, false);
  assert.match(result.error, /check it on GitHub before retrying \(retrying never double-posts\)/);
  assert.equal(commentedAt(app), null, "an unverified post is not recorded as done");
});
test("a close failure after a verified post keeps the record, so the retry cannot double-post", async () => {
  const app = harness({
    cards: [doneCard()],
    failClose: "gh: 500",
  });
  seedImport(app.db);

  const result = await app.handlers.postGithubCompletion({ cardId: "card-1", closeIssue: true });

  assert.equal(result.ok, false);
  assert.match(result.error, /close failed — close the issue manually on GitHub/);
  assert.equal(commentedAt(app), 1_700_000_000_000, "recorded before the close, never after");
});
test("the completion body states the work honestly when nothing is tracked", () => {
  const body = completionBody(
    { id: "card-1", display_name: null, name: "Fix login", prompt: "p", intent: "bugfix", stage: "Build", status: "completed" },
    [],
    (status) => status,
  );

  assert.match(body, /No scopes tracked\./);
  assert.ok(body.includes(markerFor("card-1")));
});
test("a long prompt is truncated in the write-back, the whole card is not", () => {
  const body = completionBody(
    { id: "card-1", display_name: null, name: "Fix login", prompt: "x".repeat(600), intent: "bugfix", stage: "Build", status: "completed" },
    [],
    (status) => status,
  );

  assert.match(body, /Prompt: x{500}…/, "a runaway prompt must not become a runaway comment");
});
test("the mirror poller reads only live cards and warns once per failure", async () => {
  const app = harness();
  seedImport(app.db);
  app.db.prepare("INSERT INTO cards (id, name, prompt, intent, stage, status, project_id)"
    + " VALUES ('card-done', 'Done', 'p', 'bugfix', 'Build', 'completed', 'project-1')").run();
  app.db.prepare("INSERT INTO github_imports (issue_key, repo, number, label, card_id, imported_at)"
    + " VALUES ('acme/widgets#9', ?, 9, 'bug', 'card-done', 1)").run(REPO);
  app.db.prepare("INSERT INTO cards (id, name, prompt, intent, stage, status, project_id)"
    + " VALUES ('card-live', 'Live', 'p', 'bugfix', 'Build', 'active', 'project-1')").run();
  app.db.prepare("INSERT INTO github_imports (issue_key, repo, number, label, card_id, imported_at)"
    + " VALUES ('acme/widgets#8', ?, 8, 'bug', 'card-live', 1)").run(REPO);
  // Only #1 exists upstream, so #8 fails to read and #9 would fail too — the
  // difference is whether the poller is even allowed to ask.
  app.state.items = [issue({ number: 1 })];

  await app.refreshLinkedDiscussions();
  await app.refreshLinkedDiscussions();

  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM github_issue_comments").get().n, 0, "an empty remote comment list mirrors nothing");
  assert.deepEqual(
    app.state.warned,
    [`linked discussion mirror skipped ${REPO}#8: no such issue ${REPO}#8`],
    "an unreadable live card warns once, and a completed card is never fetched at all",
  );
});

const doneCard = (overrides = {}) => ({
  id: "card-1",
  display_name: null,
  name: "Fix login",
  prompt: "p",
  intent: "bugfix",
  stage: "Build",
  status: "completed",
  ...overrides,
});

const commentedAt = (app) =>
  app.db.prepare("SELECT commented_at FROM github_imports WHERE card_id = 'card-1'").get().commented_at;
