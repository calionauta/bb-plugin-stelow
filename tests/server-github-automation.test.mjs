/**
 * Behavior tests: the watcher rules — saving, priming, the dry run, and the
 * scheduler tick.
 *
 * Each test names the product rule it guards and the change that would break
 * it. Every one is red-able: remove the spawn gate, skip the priming, or drop
 * the seen-keys read and the named test fails.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { toRuleSnapshot } from "../server/github-automation-rules.ts";
import { harness, issue, REPO, seedImport } from "./helpers/github-harness.mjs";

test("saving an auto-start rule refuses when the worker would not run isolated", async () => {
  const app = harness({ envKind: "project-default" });

  await assert.rejects(
    app.handlers.saveAutomationRule({ projectId: "project-1", labels: ["bug"], enabled: true, startImmediate: true }),
    /Auto-start refused:.*uncheck Start immediately to park drafts instead/,
  );
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM automation_rules").get().n, 0, "a refused rule is not stored");
});
test("saving an enabled rule primes the backlog instead of drafting it", async () => {
  const app = harness();

  const result = await app.handlers.saveAutomationRule({ projectId: "project-1", labels: ["bug"], enabled: true, startImmediate: false });

  assert.equal(result.primed, 1, "the current backlog is counted");
  assert.equal(app.created.length, 0, "priming never creates cards");
  const seen = app.db.prepare("SELECT source_key FROM automation_rule_seen WHERE rule_id = ?").all(result.rule.id);
  assert.deepEqual(seen.map((row) => row.source_key), [`${REPO}#1`]);
});
test("a prime failure saves the rule disabled rather than firing blind on the backlog", async () => {
  const app = harness({ failList: "gh: rate limited" });

  await assert.rejects(
    app.handlers.saveAutomationRule({ projectId: "project-1", labels: ["bug"], enabled: true, startImmediate: false }),
    /Rule saved disabled \(gh: rate limited\)\. Re-enable to prime the backlog/,
  );
  const stored = app.db.prepare("SELECT enabled FROM automation_rules").get();
  assert.equal(stored.enabled, 0, "the rule is stored but off");
});
test("toggling a rule off keeps its prompt and trusted authors", async () => {
  const app = harness();
  const saved = await app.handlers.saveAutomationRule({
    projectId: "project-1",
    labels: ["bug"],
    promptTemplate: "Focus on the login form.",
    trustedAuthors: ["octocat"],
    enabled: false,
    startImmediate: false,
  });

  const again = await app.handlers.saveAutomationRule({ id: saved.rule.id, projectId: "project-1", labels: ["bug"], enabled: false, startImmediate: false });

  assert.equal(again.rule.promptTemplate, "Focus on the login form.");
  assert.deepEqual(again.rule.trustedAuthors, ["octocat"]);
  assert.equal(again.rule.createdAt, saved.rule.createdAt, "created_at survives an update");
});
test("the rule snapshot survives a legacy single-label row and a broken labels column", () => {
  const legacy = { id: "rule-1", project_id: "project-1", enabled: 1, created_at: 1, updated_at: 2, label: "Bug" };
  assert.deepEqual(toRuleSnapshot(legacy).labels, ["Bug"], "the old single-label shape still reads");
  assert.deepEqual(toRuleSnapshot({ ...legacy, labels: "not json" }).labels, ["Bug"], "a broken labels column falls back");
  assert.deepEqual(toRuleSnapshot({ ...legacy, labels: "[]" }).labels, ["Bug"], "an empty label list is not a valid rule");
  assert.deepEqual(toRuleSnapshot({ ...legacy, trusted_authors: "octocat" }).trustedAuthors, ["octocat"], "a legacy plain author list still reads");
  assert.deepEqual(
    toRuleSnapshot({ ...legacy, trusted_authors: "not json" }).trustedAuthors,
    ["not json"],
    "a legacy plain author column is read as one author, not dropped",
  );
  assert.deepEqual(toRuleSnapshot({ ...legacy, trusted_authors: '["octocat"]' }).trustedAuthors, ["octocat"], "a JSON author list reads the same");
  assert.equal(toRuleSnapshot(legacy).startImmediate, false, "a row without the column parks by default");
});

test("a disabled rule never fires, and a live rule drafts one card per match", async () => {
  const app = harness({
    items: [issue({ number: 1 }), issue({ number: 2, labels: ["bug"] })],
  });
  await app.handlers.saveAutomationRule({
    id: "rule-1", projectId: "project-1", labels: ["bug"], enabled: false, startImmediate: false,
  });
  await app.runAutomationRules();
  assert.equal(app.created.length, 0, "a disabled rule is inert");

  app.db.prepare("UPDATE automation_rules SET enabled = 1 WHERE id = 'rule-1'").run();
  await app.runAutomationRules();

  assert.equal(app.created.length, 2, "both matching issues draft a card");
  const fires = app.db.prepare("SELECT source_key, outcome FROM automation_rule_fires ORDER BY source_key").all();
  assert.deepEqual(fires, [
    { source_key: `${REPO}#1`, outcome: "parked" },
    { source_key: `${REPO}#2`, outcome: "parked" },
  ], "every fire records how it landed, so history never reads as a mystery");
  assert.match(app.comments[0].body, /^Drafted from GitHub issue #1 \(rule bug\)$/);
});

test("an auto-start rule starts in the worktree only when the preset effectively wins", async () => {
  const isolated = harness({ envKind: "new-worktree" });
  isolated.db.prepare(enabledAutoStartRule).run();
  await isolated.runAutomationRules();
  assert.equal(isolated.created[0].start, true, "the effective worktree start is honoured");
  assert.equal(isolated.created[0].presetId, "preset-1");
  assert.equal(isolated.db.prepare("SELECT outcome FROM automation_rule_fires").get().outcome, "started");

  const parked = harness({ envKind: "project-default" });
  parked.db.prepare(enabledAutoStartRule).run();
  await parked.runAutomationRules();
  assert.equal(parked.created[0].start, false, "band routing parked the start");
  assert.equal(parked.created[0].presetId, null, "a parked draft must not carry a worktree preset");
  assert.equal(parked.db.prepare("SELECT outcome FROM automation_rule_fires").get().outcome, "parked");
  assert.equal(parked.state.warned.length, 1, "the park is explained once, not every tick");
  await parked.runAutomationRules();
  assert.equal(parked.state.warned.length, 1, "warn-once keeps a self-healing state from spamming the log");
});
test("the tick respects the backlog guard: a primed issue does not draft again", async () => {
  const app = harness();
  await app.handlers.saveAutomationRule({ projectId: "project-1", labels: ["bug"], enabled: true, startImmediate: false });

  await app.runAutomationRules();

  assert.equal(app.created.length, 0, "the issue the rule was primed with stays seen");
});
test("the preview names what would match and what would not, with a reason", async () => {
  const app = harness({ items: [issue({ number: 1, labels: ["bug", "chore"] }), issue({ number: 2, labels: ["bug"] })] });
  seedImport(app.db, { key: `${REPO}#2`, cardId: "card-1" });

  const result = await app.handlers.previewAutomationRule({ projectId: "project-1", labels: ["bug"] });

  assert.deepEqual(result.matches.map((entry) => entry.number), [1]);
  assert.deepEqual(result.skipped.map((entry) => [entry.number, entry.reason]), [[2, "already-imported"]], "a skip always names why");
  assert.equal(result.matches[0].title, "Login is broken");
});
test("a deleted rule stops firing and its history stops being readable", async () => {
  const app = harness();
  const saved = await app.handlers.saveAutomationRule({ projectId: "project-1", labels: ["bug"], enabled: true, startImmediate: false });
  app.db.prepare("INSERT INTO automation_rule_fires (rule_id, source_key, card_id, fired_at, outcome)"
    + " VALUES (?, 'acme/widgets#1', 'card-1', 1, 'parked')").run(saved.rule.id);

  const before = await app.handlers.listAutomationRuleRuns({ ruleId: saved.rule.id, limit: 20 });
  assert.equal(before.runs.length, 1, "the run history reads while the rule lives");

  await app.handlers.deleteAutomationRule({ id: saved.rule.id });

  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM automation_rules").get().n, 0, "the rule is gone");
  await app.runAutomationRules();
  assert.equal(app.created.length, 0, "a deleted rule never fires again");
  const after = await app.handlers.listAutomationRuleRuns({ ruleId: saved.rule.id, limit: 20 });
  assert.deepEqual(after.runs.map((run) => run.cardId), ["card-1"], "the recorded outcome of a past run is history, not a rule");
});

const enabledAutoStartRule = "INSERT INTO automation_rules"
  + " (id, project_id, label, labels, enabled, start_immediate, created_at, updated_at)"
  + ` VALUES ('rule-1', 'project-1', 'bug', '["bug"]', 1, 1, 1, 1)`;
