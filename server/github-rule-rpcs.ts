/**
 * The five watcher-rule RPCs: list, save, dry-run preview, run history, delete.
 *
 * Saving a rule is where the two product rules meet. The spawn gate refuses
 * auto-start unless the worker would actually run isolated, and the backlog
 * guard records the current matches as seen — on a GitHub failure the rule is
 * saved DISABLED rather than firing blind on the whole backlog next tick.
 */
import { decideAutomationSpawn, describeParkedReason } from "../lib/github-automation-gate.mjs";
import { liveImportedKeys } from "../lib/github-claims.mjs";
import { previewAutomationMatches } from "../lib/automation-rules.mjs";
import { normalizeGithubAuthors, normalizeGithubLabels } from "../lib/github-intent.mjs";
import { effectiveGithubSpawnEnvKind, requireGithubIssuesEnabled, type GithubAutomationDeps } from "./github-automation-context.js";
import type { GithubClient } from "./github-client.js";
import {
  firedAutomationKeys,
  primeAutomationRule,
  projectForRepo,
  seenAutomationKeys,
  toRuleSnapshot,
  type MatchInput,
  type RuleRow,
} from "./github-automation-rules.js";

const upsertRuleQuery = `INSERT INTO automation_rules
  (id, project_id, label, labels, trusted_authors, prompt_template, enabled, start_immediate, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET label = excluded.label, labels = excluded.labels,
    trusted_authors = excluded.trusted_authors, prompt_template = excluded.prompt_template,
    enabled = excluded.enabled, start_immediate = excluded.start_immediate, updated_at = excluded.updated_at`;
const selectRuleColumns = "SELECT created_at, prompt_template, trusted_authors FROM automation_rules WHERE id = ?";
const disableRuleQuery = "UPDATE automation_rules SET enabled = 0, updated_at = ? WHERE id = ?";
const projectRulesQuery = "SELECT * FROM automation_rules WHERE project_id = ? ORDER BY created_at DESC";
const projectRuleIdsQuery = "SELECT id FROM automation_rules WHERE project_id = ?";
const allRulesQuery = "SELECT * FROM automation_rules WHERE id = ?";
const deleteRuleQuery = "DELETE FROM automation_rules WHERE id = ?";
const listRunsQuery = `SELECT f.source_key, f.card_id, f.fired_at, f.outcome, g.repo, g.number
  FROM automation_rule_fires f LEFT JOIN github_imports g ON g.issue_key = f.source_key
  WHERE f.rule_id = ? ORDER BY f.fired_at DESC LIMIT ?`;

type RunRow = {
  source_key: string;
  card_id: string;
  fired_at: number;
  outcome: string | null;
  repo: string | null;
  number: number | null;
};
type SaveRuleInput = {
  id?: string | null;
  projectId: string;
  labels?: string[];
  label?: string;
  trustedAuthors?: string[] | string;
  promptTemplate?: string;
  enabled: boolean;
  startImmediate: boolean;
};
type PreviewRuleInput = {
  projectId: string;
  labels?: string[];
  label?: string;
  trustedAuthors?: string[] | string;
};

async function listAutomationRules(ctx: GithubAutomationDeps, { projectId }: { projectId: string | null }) {
  requireGithubIssuesEnabled();
  if (!projectId) return { rules: [] };
  const rows = ctx.db.prepare(projectRulesQuery).all(projectId) as RuleRow[];
  return { rules: rows.map((rule) => toRuleSnapshot(rule)) };
}

async function saveAutomationRule(
  ctx: GithubAutomationDeps,
  client: GithubClient,
  input: SaveRuleInput,
) {
  const { id, projectId, labels, label, trustedAuthors, promptTemplate, enabled, startImmediate } = input;
  const { db } = ctx;
  requireGithubIssuesEnabled();
  const clean = normalizeGithubLabels(labels ?? label);
  if (clean.length === 0) throw new Error("Rule needs at least one label.");
  const authors = normalizeGithubAuthors(trustedAuthors ?? []);
  const template = typeof promptTemplate === "string" ? promptTemplate.trim().slice(0, 2_000) : "";
  // Fail closed on isolation through the same gate the tick uses: the
  // EFFECTIVE spawn environment (band routing wins), never mere preset
  // existence. Every refusal names the exit.
  const gate = decideAutomationSpawn({ startImmediate, effectiveEnvKind: effectiveGithubSpawnEnvKind(ctx) });
  if (startImmediate && !gate.start) {
    const reason = describeParkedReason(gate.parkedReason);
    throw new Error(`Auto-start refused: ${reason}. Create a New-worktree preset in Agent Presets, or uncheck Start immediately to park drafts instead.`);
  }
  const ts = ctx.now();
  const ruleId = id ?? ctx.randomId("rule");
  const existing = db.prepare(selectRuleColumns).get(ruleId) as
    { created_at: number; prompt_template: string | null; trusted_authors: string | null } | undefined;
  const createdAt = existing?.created_at ?? ts;
  // Absent template/authors keep the stored value so the enable toggle
  // never wipes them.
  const storedTemplate = promptTemplate === undefined ? (existing?.prompt_template ?? "") : template;
  const storedAuthors = trustedAuthors === undefined
    ? (existing?.trusted_authors ?? null)
    : (authors.length > 0 ? JSON.stringify(authors) : null);
  db.prepare(upsertRuleQuery)
    .run(ruleId, projectId, clean[0], JSON.stringify(clean), storedAuthors, storedTemplate, enabled ? 1 : 0, startImmediate ? 1 : 0, createdAt, ts);
  // Backlog guard: an enabled rule records current matches as seen without
  // creating cards. On GitHub failure the rule is saved DISABLED instead of
  // firing blind on the backlog next tick.
  let primed = 0;
  if (enabled) {
    try {
      primed = await primeAutomationRule(db, client, () => ctx.now(), ruleId, projectId, clean, authors);
    } catch (error) {
      db.prepare(disableRuleQuery).run(ctx.now(), ruleId);
      const message = error instanceof Error ? error.message : "GitHub unreachable";
      throw new Error(`Rule saved disabled (${message}). Re-enable to prime the backlog and go live.`);
    }
  }
  const saved = db.prepare(allRulesQuery).get(ruleId) as RuleRow;
  return { rule: toRuleSnapshot(saved), primed };
}

async function previewAutomationRule(
  ctx: GithubAutomationDeps,
  client: GithubClient,
  input: PreviewRuleInput,
) {
  const { projectId, labels, label, trustedAuthors } = input;
  const { db } = ctx;
  requireGithubIssuesEnabled();
  const clean = normalizeGithubLabels(labels ?? label);
  if (clean.length === 0) throw new Error("Pick at least one label to preview.");
  const authors = normalizeGithubAuthors(trustedAuthors ?? []);
  const items = await client.listItems({ kind: "issue", state: "open" }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "GitHub plugin unavailable";
    throw new Error(`GitHub preview unavailable: ${message}`);
  });
  const repos = await projectForRepo(client);
  const byKey = new Map(items.items.map((item) => [`${item.repo}#${item.number}`, item]));
  const firedKeys = new Set<string>();
  const seenKeys = new Set<string>();
  for (const row of db.prepare(projectRuleIdsQuery).all(projectId) as Array<{ id: string }>) {
    for (const key of firedAutomationKeys(db, row.id)) firedKeys.add(key);
    for (const key of seenAutomationKeys(db, row.id)) seenKeys.add(key);
  }
  const previewInput: MatchInput = {
    labels: clean,
    trustedAuthors: authors,
    projectId,
    projectForRepo: repos,
    firedKeys,
    seenKeys,
    importedKeys: liveImportedKeys(db),
  };
  const { matches, skipped } = previewAutomationMatches(items.items, previewInput);
  const titleOf = (key: string): { title: string; url: string; author: string } => {
    const item = byKey.get(key);
    return { title: item?.title ?? key, url: item?.url ?? "", author: item?.author ?? "" };
  };
  return {
    matches: matches.slice(0, 50).map((entry) => ({ ...titleOf(entry.key), repo: entry.repo, number: entry.number })),
    skipped: skipped.slice(0, 50).map((entry) => ({
      ...titleOf(entry.key),
      repo: entry.repo,
      number: entry.number,
      reason: entry.reason,
      owner: entry.owner ?? null,
    })),
    checkedAt: ctx.now(),
  };
}

async function listAutomationRuleRuns(ctx: GithubAutomationDeps, { ruleId, limit }: { ruleId: string; limit: number }) {
  requireGithubIssuesEnabled();
  const rows = ctx.db.prepare(listRunsQuery).all(ruleId, limit) as RunRow[];
  return {
    runs: rows.map((row) => {
      const card = ctx.cards.get(row.card_id);
      const [repo, number] = row.repo !== null && row.number !== null
        ? [row.repo, row.number]
        : [String(row.source_key.split("#")[0] ?? row.source_key), Number(row.source_key.split("#")[1] ?? 0)];
      return {
        sourceKey: row.source_key,
        repo,
        number,
        cardId: row.card_id,
        cardName: card ? (card.display_name ?? card.name) : null,
        cardStatus: card ? ctx.cards.normalizeStatus(card.status) : null,
        outcome: row.outcome,
        firedAt: row.fired_at,
      };
    }),
  };
}

async function deleteAutomationRule(ctx: GithubAutomationDeps, { id }: { id: string }) {
  requireGithubIssuesEnabled();
  ctx.db.prepare(deleteRuleQuery).run(id);
  return { ok: true };
}

export function githubRuleHandlers(ctx: GithubAutomationDeps, client: GithubClient) {
  return {
    listAutomationRules: (input: { projectId: string | null }) => listAutomationRules(ctx, input),
    saveAutomationRule: (input: SaveRuleInput) => saveAutomationRule(ctx, client, input),
    previewAutomationRule: (input: PreviewRuleInput) => previewAutomationRule(ctx, client, input),
    listAutomationRuleRuns: (input: { ruleId: string; limit: number }) => listAutomationRuleRuns(ctx, input),
    deleteAutomationRule: (input: { id: string }) => deleteAutomationRule(ctx, input),
  };
}
