/**
 * The scheduler side of watcher rules: the stored-row shape, the backlog
 * guard, and the tick that drafts or starts cards for what a rule matches.
 *
 * The five rule RPCs live next door in github-rule-rpcs.ts.
 *
 * Two rules govern every tick. The backlog guard (priming) records the
 * currently-matching issues as seen without creating cards, so enabling a
 * rule only ever drafts genuinely new issues. The spawn gate parks auto-start
 * unless the worker would actually run isolated, and re-checks every tick —
 * the preset may vanish later. Both name their exit in the log.
 */
import { decideAutomationSpawn, describeParkedReason } from "../lib/github-automation-gate.mjs";
import { liveImportedKeys } from "../lib/github-claims.mjs";
import { matchAutomationIssues } from "../lib/automation-rules.mjs";
import { normalizeGithubAuthors, normalizeGithubLabels } from "../lib/github-intent.mjs";
import {
  effectiveGithubSpawnEnvKind,
  githubIssuesEnabled,
  resolveWorktreePreset,
  type GithubAutomationDeps,
  type GithubDb,
} from "./github-automation-context.js";
import type { GithubClient, GithubIssueItem } from "./github-client.js";
import type { CreateCardArgs } from "./github-issue-flow.js";

export type RuleRow = { id: string; project_id: string; enabled: number; created_at: number; updated_at: number } & Record<string, unknown>;
type WarnOnce = (key: string) => boolean;
export type MatchInput = {
  labels: string[];
  trustedAuthors: string[];
  projectId: string;
  projectForRepo: Map<string, string | null>;
  firedKeys: Set<string>;
  seenKeys: Set<string>;
  importedKeys: Set<string>;
};
type SpawnDecision = { start: boolean; parkedReason: string | null };
type Match = { key: string; repo: string; number: number };
type CreateCard = (args: CreateCardArgs) => Promise<{ cardId: string | null; skipped: string | null }>;

function ruleLabelsOf(row: Record<string, unknown>): string[] {
  const fromJson = (() => {
    if (typeof row.labels !== "string" || !row.labels) return null;
    try {
      const clean = normalizeGithubLabels(JSON.parse(row.labels) as unknown);
      return clean.length > 0 ? clean : null;
    } catch { return null; }
  })();
  if (fromJson) return fromJson;
  return normalizeGithubLabels(row.label);
}

function rulePromptOf(row: Record<string, unknown>): string {
  return typeof row.prompt_template === "string" ? row.prompt_template.trim().slice(0, 2_000) : "";
}

function ruleAuthorsOf(row: Record<string, unknown>): string[] {
  if (typeof row.trusted_authors !== "string" || !row.trusted_authors) return [];
  try {
    return normalizeGithubAuthors(JSON.parse(row.trusted_authors) as unknown);
  } catch {
    return normalizeGithubAuthors(row.trusted_authors);
  }
}

export function toRuleSnapshot(row: RuleRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    labels: ruleLabelsOf(row),
    trustedAuthors: ruleAuthorsOf(row),
    promptTemplate: rulePromptOf(row),
    enabled: row.enabled === 1,
    startImmediate: Number(row.start_immediate ?? 0) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Liveness behind the single dedupe lives in lib/github-claims.mjs
// (tested): cardless, claimless rows read as not-imported so a deleted
// card's issue can come back.
const seenKeysQuery = "SELECT source_key FROM automation_rule_seen WHERE rule_id = ?";
const firedKeysQuery = "SELECT source_key FROM automation_rule_fires WHERE rule_id = ?";
const insertSeenQuery = "INSERT OR IGNORE INTO automation_rule_seen (rule_id, source_key, seen_at) VALUES (?, ?, ?)";
const insertFireQuery = "INSERT OR IGNORE INTO automation_rule_fires (rule_id, source_key, card_id, fired_at, outcome) VALUES (?, ?, ?, ?, ?)";
const enabledRulesQuery = "SELECT * FROM automation_rules WHERE enabled = 1";

export function seenAutomationKeys(db: GithubDb, ruleId: string): Set<string> {
  return new Set((db.prepare(seenKeysQuery).all(ruleId) as Array<{ source_key: string }>).map((row) => row.source_key));
}

export function firedAutomationKeys(db: GithubDb, ruleId: string): Set<string> {
  return new Set((db.prepare(firedKeysQuery).all(ruleId) as Array<{ source_key: string }>).map((row) => row.source_key));
}

export function projectForRepo(client: GithubClient): Promise<Map<string, string | null>> {
  return client.statusResolved()
    .catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }))
    .then((status) => new Map(status.repos.map((entry) => [entry.repo, entry.projectId])));
}

// Backlog guard: record currently-matching issues as seen without creating
// cards. Throws on GitHub failure so the caller saves disabled instead of
// firing blind on the full backlog next tick.
export async function primeAutomationRule(
  db: GithubDb,
  client: GithubClient,
  now: () => number,
  ruleId: string,
  projectId: string,
  labels: string[],
  trustedAuthors: string[],
): Promise<number> {
  const items = await client.listItems({ kind: "issue", state: "open" });
  const input: MatchInput = {
    labels,
    trustedAuthors,
    projectId,
    projectForRepo: await projectForRepo(client),
    firedKeys: firedAutomationKeys(db, ruleId),
    seenKeys: seenAutomationKeys(db, ruleId),
    importedKeys: liveImportedKeys(db),
  };
  const matches = matchAutomationIssues(items.items, input);
  const ts = now();
  for (const match of matches) {
    db.prepare(insertSeenQuery).run(ruleId, match.key, ts);
  }
  return matches.length;
}

async function importMatchForRule(
  ctx: GithubAutomationDeps,
  row: RuleRow,
  match: Match,
  decision: SpawnDecision,
  worktreePreset: string | null,
  rulePrompt: string,
  labels: string[],
  importedKeys: Set<string>,
  createCard: CreateCard,
): Promise<void> {
  const created = await createCard({
    projectId: row.project_id,
    repo: match.repo,
    number: match.number,
    triggerLabels: labels,
    start: decision.start,
    presetId: worktreePreset,
    rulePrompt,
  });
  if (created.skipped === "in-flight" || !created.cardId) return;
  const card = ctx.cards.get(created.cardId);
  if (card) {
    const note = decision.start ? "Started in an isolated worktree" : "Drafted";
    const fallback = decision.parkedReason ? ` (${describeParkedReason(decision.parkedReason)})` : "";
    ctx.cards.comment(card.id, "card", card.id, "agent", `${note} from GitHub issue #${match.number} (rule ${labels.join(" + ")})${fallback}`);
  }
  const outcome = decision.start ? "started" : created.skipped === "already-imported" ? "already-imported" : "parked";
  ctx.db.prepare(insertFireQuery).run(row.id, match.key, created.cardId, ctx.now(), outcome);
  importedKeys.add(match.key);
  ctx.bb.realtime.publish("board-changed", { reason: "automation-draft", cardId: created.cardId });
}

async function runSingleAutomationRule(
  ctx: GithubAutomationDeps,
  warnOnce: WarnOnce,
  createCard: CreateCard,
  row: RuleRow,
  items: GithubIssueItem[],
  repos: Map<string, string | null>,
  importedKeys: Set<string>,
): Promise<void> {
  const { db, bb } = ctx;
  const labels = ruleLabelsOf(row);
  if (labels.length === 0) return;
  const trustedAuthors = ruleAuthorsOf(row);
  const rulePrompt = rulePromptOf(row);
  const startImmediate = Number(row.start_immediate ?? 0) === 1;
  const input: MatchInput = {
    labels,
    trustedAuthors,
    projectId: row.project_id,
    projectForRepo: repos,
    firedKeys: firedAutomationKeys(db, row.id),
    seenKeys: seenAutomationKeys(db, row.id),
    importedKeys,
  };
  const matches = matchAutomationIssues(items, input).slice(0, 10);
  if (matches.length === 0) return;
  // Gate on the EFFECTIVE spawn environment (band routing wins over any
  // passed preset): auto-start parks unless the worker would actually
  // run isolated. Re-checked every tick — the preset may vanish later.
  const decision = decideAutomationSpawn({ startImmediate, effectiveEnvKind: effectiveGithubSpawnEnvKind(ctx) });
  const worktreePreset = decision.start ? resolveWorktreePreset(ctx) : null;
  if (decision.parkedReason && warnOnce(`${row.id}:parked:${labels.join("+")}`)) {
    bb.log.warn(`automation rule ${row.id} parked ${matches.length} matches: ${describeParkedReason(decision.parkedReason)}`);
  }
  for (const match of matches) {
    try {
      await importMatchForRule(ctx, row, match, decision, worktreePreset, rulePrompt, labels, importedKeys, createCard);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Persistent config states (repo with no BB project yet) retry
      // silently after one warning — self-healing, no 5-minute spam.
      if (warnOnce(`${row.id}:${match.key}:${message}`)) {
        bb.log.warn(`automation rule ${row.id} skipped ${match.key}: ${message}`);
      }
    }
  }
}

export async function runAutomationRules(
  ctx: GithubAutomationDeps,
  client: GithubClient,
  warnOnce: WarnOnce,
  createCard: CreateCard,
): Promise<void> {
  const { db } = ctx;
  if (!githubIssuesEnabled()) return;
  const rows = db.prepare(enabledRulesQuery).all() as RuleRow[];
  if (rows.length === 0) return;
  const items = await client.listItems({ kind: "issue", state: "open" }).catch(() => null);
  if (!items) return;
  const repos = await projectForRepo(client);
  const importedKeys = liveImportedKeys(db);
  for (const row of rows) {
    await runSingleAutomationRule(ctx, warnOnce, createCard, row, items.items, repos, importedKeys);
  }
}
