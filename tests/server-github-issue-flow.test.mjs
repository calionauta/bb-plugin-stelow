/**
 * Behavior tests: the issue flow — candidate listing, import, and creating a
 * GitHub issue for a card.
 *
 * Each test names the product rule it guards and the change that would break
 * it. Every one is red-able: flip the spawn gate, drop the claim, or lose the
 * preset and the named test fails.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { githubIssuePrompt } from "../server/github-issue-flow.ts";
import { harness, issue, REPO, seedImport } from "./helpers/github-harness.mjs";

test("importing a fresh issue creates one card, links it, and clears the trigger label", async () => {
  const app = harness();

  const result = await app.handlers.importGithubIssue({ repo: REPO, number: 1, labels: ["bug"], start: true });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, null);
  assert.equal(app.created.length, 1, "one card per issue");
  assert.equal(app.created[0].start, true, "the caller's start policy reaches the card");
  assert.match(app.created[0].prompt, /GitHub issue acme\/widgets#1: Login is broken/);
  const link = app.db.prepare("SELECT card_id, claimed_by FROM github_imports WHERE issue_key = ?").get(`${REPO}#1`);
  assert.equal(link.card_id, result.cardId, "the import is linked to the card it made");
  assert.equal(link.claimed_by, null, "the claim is released, not left held");
  assert.deepEqual(app.state.labeled, [{ repo: REPO, number: 1, labels: [] }], "the trigger label is cleared upstream");
});
test("a second import of the same issue converges on the live card instead of orphaning one", async () => {
  const app = harness();
  const first = await app.handlers.importGithubIssue({ repo: REPO, number: 1, start: true });

  const second = await app.handlers.importGithubIssue({ repo: REPO, number: 1, start: true });

  assert.equal(second.cardId, first.cardId);
  assert.equal(second.skipped, "already-imported");
  assert.equal(app.created.length, 1, "no second card is created");
});
test("a link whose card was deleted reads as not-imported, so the issue can come back", async () => {
  // A link whose card is gone: the row still names a card that no longer
  // exists (deleted card, FKs off). It must read as not-imported everywhere.
  const app = harness();
  seedImport(app.db, { cardId: "card-gone" });

  const result = await app.handlers.importGithubIssue({ repo: REPO, number: 1, start: false });

  assert.equal(result.skipped, null, "a cardless link is not an import");
  assert.equal(app.created.length, 1, "the issue is imported again");
});
test("an import that fails mid-flight releases its claim so the next attempt can own the key", async () => {
  const app = harness();
  app.state.items = [];

  await assert.rejects(
    app.handlers.importGithubIssue({ repo: REPO, number: 1, start: true }),
    /GitHub import unavailable/,
    "a failed import is visible, not a phantom import",
  );
  const row = app.db.prepare("SELECT card_id, claimed_by FROM github_imports WHERE issue_key = ?").get(`${REPO}#1`);
  assert.equal(row.card_id, null);
  assert.equal(row.claimed_by, null, "a held claim after a failure would wedge the issue for good");

  app.state.items = [issue()];
  const retried = await app.handlers.importGithubIssue({ repo: REPO, number: 1, start: true });
  assert.equal(retried.skipped, null, "the retry owns the key and imports it");
  assert.equal(app.created.length, 1);
});

test("an unreachable GitHub plugin refuses the import and names the reason", async () => {
  const app = harness({ failList: "gh: could not connect" });

  await assert.rejects(
    app.handlers.listGithubCandidates({ labels: ["bug"] }),
    /GitHub import unavailable: gh: could not connect/,
    "an empty candidate list would be a mystery, so the refusal travels",
  );
});
test("candidates list only the watched issues, newest first, with their import state", async () => {
  const app = harness({
    items: [
      issue({ number: 1, labels: ["bug"] }),
      issue({ number: 7, labels: ["bug", "chore"] }),
      issue({ number: 9, labels: ["chore"] }),
    ],
  });
  seedImport(app.db, { key: `${REPO}#7`, cardId: "card-1" });

  const result = await app.handlers.listGithubCandidates({ labels: ["bug"] });

  assert.deepEqual(result.issues.map((entry) => entry.number), [7, 1], "only watched issues, newest first");
  assert.equal(result.issues[0].alreadyImported, true);
  assert.equal(result.issues[0].cardName, "Fix login");
  assert.equal(result.issues[1].alreadyImported, false);
  assert.ok(result.allLabels.includes("bug") && result.allAssignees.includes("octocat"), "pickers merge the remote lists");
});
test("the import prompt carries the issue body so the worker does not re-fetch GitHub", () => {
  const prompt = githubIssuePrompt(issue(), [{ author: "octocat", body: "  Still broken.  ", createdAt: "2026-09-20T10:00:00Z" }]);

  assert.match(prompt, /Description:\nIt 500s on submit\./);
  assert.match(prompt, /- octocat: Still broken\./, "comments are trimmed into the prompt");
  assert.match(githubIssuePrompt(issue({ body: "   " })), /\(no description\)/, "an empty body says so instead of leaving a gap");
});
test("an isolated import refuses when no worktree preset would actually run, and names the exit", async () => {
  const app = harness({ envKind: "project-default" });

  await assert.rejects(
    app.handlers.importGithubIssue({ repo: REPO, number: 1, start: true, isolated: true }),
    /Isolated start refused:.*Create a New-worktree preset in Agent Presets.*uncheck Isolated worktree/s,
    "a silent checkout is the failure this guard exists to prevent",
  );
  assert.equal(app.created.length, 0, "the refusal happens before the card is made");
});
test("an isolated import that parks pins the preset so the later Start stays isolated", async () => {
  const app = harness();

  const result = await app.handlers.importGithubIssue({ repo: REPO, number: 1, start: false, isolated: true });

  assert.equal(result.skipped, null);
  assert.deepEqual(app.state.pinned, { cardId: result.cardId, presetId: "preset-1" });
  assert.equal(app.created[0].presetId, "preset-1");
});
test("a park whose worktree preset vanished refuses instead of losing the isolation choice", async () => {
  const app = harness({ pinSucceeds: false });

  await assert.rejects(
    app.handlers.importGithubIssue({ repo: REPO, number: 1, start: false, isolated: true }),
    /Isolated start refused: the worktree preset no longer exists\. Choose a New-worktree preset/,
    "a pinned draft that cannot hold the preset must not read as an isolated start",
  );
  const linked = app.db.prepare("SELECT card_id FROM github_imports WHERE issue_key = ?").get(`${REPO}#1`);
  assert.equal(app.state.pinned.cardId, linked.card_id, "the pin names the card the import actually linked");
  assert.equal(app.state.pinned.presetId, "preset-1", "and it pins the worktree preset, not some other choice");
});
test("a linked card returns its issue instead of creating a second one", async () => {
  const app = harness();
  seedImport(app.db);

  const result = await app.handlers.createLinkedGithubIssue({ cardId: "card-1" });

  assert.deepEqual(result, { ok: true, url: `https://github.com/${REPO}/issues/1`, number: 1, error: null });
});
test("creating a linked issue refuses when GitHub is not connected, naming the setup", async () => {
  const app = harness({ ghOk: false });

  const result = await app.handlers.createLinkedGithubIssue({ cardId: "card-1" });

  assert.equal(result.ok, false);
  assert.match(result.error, /GitHub is not connected — set up GitHub auth first/);
});
test("the seam exposes exactly the surface the runtime registers", () => {
  const app = harness();

  assert.deepEqual(
    Object.keys(app.handlers).sort(),
    [
      "createLinkedGithubIssue",
      "deleteAutomationRule",
      "getLinkedDiscussion",
      "importGithubIssue",
      "listAutomationRuleRuns",
      "listAutomationRules",
      "listGithubCandidates",
      "postGithubCompletion",
      "postIssueComment",
      "previewAutomationRule",
      "saveAutomationRule",
    ],
  );
  assert.equal(typeof app.runAutomationRules, "function");
  assert.equal(typeof app.refreshLinkedDiscussions, "function");
  assert.equal(typeof app.githubStatus, "function");
});
test("every rule RPC refuses on a disabled host and names the switch", async () => {
  const app = harness();
  const previous = process.env.STELOW_GITHUB_ISSUES;
  process.env.STELOW_GITHUB_ISSUES = "0";
  try {
    const refusals = [
      app.handlers.listAutomationRules({ projectId: "project-1" }),
      app.handlers.saveAutomationRule({ projectId: "project-1", labels: ["bug"], enabled: true, startImmediate: false }),
      app.handlers.listGithubCandidates({ labels: ["bug"] }),
      app.handlers.importGithubIssue({ repo: REPO, number: 1, start: true }),
      app.handlers.postGithubCompletion({ cardId: "card-1", closeIssue: false }),
      app.handlers.getLinkedDiscussion({ cardId: "card-1" }),
      app.handlers.postIssueComment({ cardId: "card-1", body: "Done." }),
      app.handlers.createLinkedGithubIssue({ cardId: "card-1" }),
      app.handlers.previewAutomationRule({ projectId: "project-1", labels: ["bug"] }),
      app.handlers.deleteAutomationRule({ id: "rule-1" }),
      app.handlers.listAutomationRuleRuns({ ruleId: "rule-1", limit: 20 }),
    ];
    for (const refusal of refusals) {
      await assert.rejects(refusal, /STELOW_GITHUB_ISSUES=0/, "a disabled host names the switch instead of failing blank");
    }
    await app.runAutomationRules();
    await app.refreshLinkedDiscussions();
    assert.equal(app.created.length, 0, "the schedulers stand down too");
  } finally {
    if (previous === undefined) delete process.env.STELOW_GITHUB_ISSUES;
    else process.env.STELOW_GITHUB_ISSUES = previous;
  }
});
