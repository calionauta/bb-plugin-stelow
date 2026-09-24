/**
 * GitHub issues, decoupled from the main plugin server.
 *
 * Everything about bringing GitHub issues into Stelow — manual import,
 * automation rules, dry-run preview, run history, completion write-back —
 * lives here behind one seam: createGithubAutomation(ctx). Core migrations
 * call runGithubMigrations; the runtime registers handlers and schedules work.
 *
 * Kill switch: STELOW_GITHUB_ISSUES=0 disables the scheduler and every
 * RPC (each refusal names the variable). No migration, no UI change.
 */

import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { execFile } from "node:child_process";
import { z } from "zod";
import { decideAutomationSpawn, describeParkedReason } from "../lib/github-automation-gate.mjs";
import { acquireGithubImportClaim, completeGithubImport, liveImportedKeys, releaseGithubClaim } from "../lib/github-claims.mjs";
import { buildCreateIssueArgs, issueBodyForCard, issueKey, parseCreateIssueResponse, resolveGhPath, resolveTargetRepo, validatePostBody } from "../lib/github-issue-create.mjs";
import { toMirrorRows } from "../lib/github-issue-comments.mjs";
import { applyRulePrompt, findRelatedIssues, githubIntentFor, normalizeGithubAuthors, normalizeGithubLabels } from "../lib/github-intent.mjs";
import { carriesMarker, markerFor } from "../lib/github-writeback.mjs";
import { matchAutomationIssues, previewAutomationMatches } from "../lib/automation-rules.mjs";
import { sortedUnion } from "../lib/github-lists.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/** Minimal card shape this feature needs — the core CardRow satisfies it. */
export interface GithubCard {
  id: string;
  display_name: string | null;
  name: string;
  prompt: string;
  intent: string;
  stage: string;
  status: string;
}

export interface GithubAutomationDeps {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  randomId: (prefix: string) => string;
  presets: {
    getWorktreePresetId: () => string | null;
    getEffectiveBuildEnvironmentKind: () => string;
    pinCardPreset: (cardId: string, presetId: string) => boolean;
  };
  cards: {
    get: (cardId: string) => GithubCard | undefined;
    create: (args: {
      projectId: string;
      prompt: string;
      attachments: Array<{ path: string; type: "localFile" | "localImage" }>;
      intent: string;
      appetite: string;
      reviewMode: string | string[];
      presetId?: string | null;
      start?: boolean;
    }) => Promise<{ cardId: string; threadId: string | null }>;
    comment: (cardId: string, target: string, targetId: string, author: "user" | "agent", body: string) => string;
    workspace: (card: GithubCard) => Promise<{ path: string; hostId: string | null } | null>;
    scopes: (card: GithubCard, rootPath: string | null) => Array<{ name: string; status: string; tasks: Array<{ status: string }> }>;
    normalizeStatus: (value: unknown) => string;
    statusLabel: (status: string) => string;
  };
}

export function githubIssuesEnabled(): boolean {
  return process.env.STELOW_GITHUB_ISSUES !== "0";
}

const automationRuleSchema = z.object({ id: z.string(), projectId: z.string(), enabled: z.boolean(), labels: z.array(z.string().min(1).max(60)).min(1).max(10), trustedAuthors: z.array(z.string().min(1).max(40)).max(20), promptTemplate: z.string().max(2_000), startImmediate: z.boolean(), createdAt: z.number(), updatedAt: z.number() });

export const githubRpcContract = defineRpcContract({
  listGithubCandidates: {
    experimental_description: "GitHub issues matching watcher labels, with import state",
    input: z.object({ labels: z.array(z.string().min(1).max(60)).min(1).max(10).optional(), label: z.string().min(1).max(60).optional() }).strict(),
    output: z.object({
      issues: z.array(z.object({
        repo: z.string(), number: z.number().int().positive(), title: z.string(), labels: z.array(z.string()), author: z.string(), assignees: z.array(z.string()), url: z.string(), body: z.string(), updatedAt: z.string(), projectId: z.string().nullable(), alreadyImported: z.boolean(), cardId: z.string().nullable(), cardName: z.string().nullable(), cardStatus: z.string().nullable(), postedAt: z.number().nullable(), related: z.array(z.string()),
      })),
      allLabels: z.array(z.string()),
      allAssignees: z.array(z.string()),
    }),
  },
  importGithubIssue: {
    experimental_description: "Import one GitHub issue as a parked or started card",
    input: z.object({ projectId: z.string().nullable().optional(), repo: z.string(), number: z.number().int().positive(), labels: z.array(z.string().min(1).max(60)).max(10).optional(), label: z.string().min(1).max(60).optional(), start: z.boolean().default(true), isolated: z.boolean().default(false), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).optional() }).strict(),
    output: z.object({ ok: z.boolean(), cardId: z.string().nullable(), skipped: z.string().nullable(), error: z.string().nullable() }),
  },
  listAutomationRules: {
    experimental_description: "Per-project GitHub label watchers with recent run outcomes",
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({ rules: z.array(automationRuleSchema) }),
  },
  saveAutomationRule: {
    experimental_description: "Create or update a label watcher; fails closed without isolation",
    input: z.object({ id: z.string().nullable().optional(), projectId: z.string(), labels: z.array(z.string().min(1).max(60)).min(1).max(10).optional(), label: z.string().min(1).max(60).optional(), trustedAuthors: z.union([z.array(z.string().min(1).max(40)).max(20), z.string().max(800)]).optional(), promptTemplate: z.string().max(2_000).optional(), enabled: z.boolean().default(true), startImmediate: z.boolean().default(false) }).strict(),
    output: z.object({ rule: automationRuleSchema, primed: z.number().int().nonnegative() }),
  },
  previewAutomationRule: {
    experimental_description: "Dry-run a label watcher: what would match now, and why not",
    input: z.object({ projectId: z.string(), labels: z.array(z.string().min(1).max(60)).min(1).max(10).optional(), label: z.string().min(1).max(60).optional(), trustedAuthors: z.union([z.array(z.string().min(1).max(40)).max(20), z.string().max(800)]).optional() }).strict(),
    output: z.object({
      matches: z.array(z.object({ repo: z.string(), number: z.number().int().positive(), title: z.string(), url: z.string(), author: z.string() })),
      skipped: z.array(z.object({ repo: z.string(), number: z.number().int().positive(), title: z.string(), reason: z.string(), owner: z.string().nullable() })),
      checkedAt: z.number(),
    }),
  },
  listAutomationRuleRuns: {
    experimental_description: "Recent scheduler runs for one watcher rule",
    input: z.object({ ruleId: z.string(), limit: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ runs: z.array(z.object({ sourceKey: z.string(), repo: z.string(), number: z.number().int().positive(), cardId: z.string(), cardName: z.string().nullable(), cardStatus: z.string().nullable(), outcome: z.string().nullable(), firedAt: z.number() })) }),
  },
  deleteAutomationRule: {
    experimental_description: "Delete a label watcher rule",
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  postGithubCompletion: {
    experimental_description: "Post a card completion summary back to its GitHub issue",
    input: z.object({ cardId: z.string(), closeIssue: z.boolean().default(false) }).strict(),
    output: z.object({ ok: z.boolean(), issueUrl: z.string().nullable(), error: z.string().nullable() }),
  },
  createLinkedGithubIssue: {
    experimental_description: "Create a GitHub issue for a card and link it",
    input: z.object({ cardId: z.string(), repo: z.string().nullable().optional() }).strict(),
    output: z.object({ ok: z.boolean(), url: z.string().nullable(), number: z.number().int().positive().nullable(), error: z.string().nullable() }),
  },
  getLinkedDiscussion: {
    experimental_description: "Read-only mirror of the linked GitHub issue comments",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      linked: z.boolean(),
      repo: z.string().nullable(),
      number: z.number().int().positive().nullable(),
      url: z.string().nullable(),
      comments: z.array(z.object({ author: z.string(), body: z.string(), createdAt: z.number() })),
      updatedAt: z.number().nullable(),
      canCreate: z.boolean(),
      repos: z.array(z.string()),
    }),
  },
  postIssueComment: {
    experimental_description: "Post a human-approved comment to the linked GitHub issue",
    input: z.object({ cardId: z.string(), body: z.string().min(1).max(60000) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
});

export function runGithubMigrations(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS github_imports (
    issue_key TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    number INTEGER NOT NULL,
    label TEXT NOT NULL,
    card_id TEXT,
    imported_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_github_imports_label ON github_imports(label);`);
  const githubImportColumns = db.prepare("PRAGMA table_info(github_imports)").all() as Array<{ name: string }>;
  if (!githubImportColumns.some((column) => column.name === "commented_at")) db.exec("ALTER TABLE github_imports ADD COLUMN commented_at INTEGER");
  if (!githubImportColumns.some((column) => column.name === "claimed_by")) db.exec("ALTER TABLE github_imports ADD COLUMN claimed_by TEXT");

  db.exec(`CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS automation_rule_fires (
    rule_id TEXT NOT NULL, source_key TEXT NOT NULL, card_id TEXT NOT NULL, fired_at INTEGER NOT NULL,
    PRIMARY KEY (rule_id, source_key),
    FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS automation_rule_seen (
    rule_id TEXT NOT NULL, source_key TEXT NOT NULL, seen_at INTEGER NOT NULL,
    PRIMARY KEY (rule_id, source_key),
    FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE
  );`);
  // Read-only mirror of linked issue comments (getLinkedDiscussion): identity
  // is the content fingerprint, so re-fetches converge via INSERT OR IGNORE.
  // Self-created like every table here — no legacy state, nothing for the
  // v1 cleanup.
  db.exec(`CREATE TABLE IF NOT EXISTS github_issue_comments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_github_issue_comments_card ON github_issue_comments(card_id, created_at);`);
  const automationRuleColumns = db.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>;
  if (!automationRuleColumns.some((column) => column.name === "labels")) db.exec("ALTER TABLE automation_rules ADD COLUMN labels TEXT");
  if (!automationRuleColumns.some((column) => column.name === "start_immediate")) db.exec("ALTER TABLE automation_rules ADD COLUMN start_immediate INTEGER NOT NULL DEFAULT 0");
  if (!automationRuleColumns.some((column) => column.name === "prompt_template")) db.exec("ALTER TABLE automation_rules ADD COLUMN prompt_template TEXT NOT NULL DEFAULT ''");
  if (!automationRuleColumns.some((column) => column.name === "trusted_authors")) db.exec("ALTER TABLE automation_rules ADD COLUMN trusted_authors TEXT");
  for (const row of db.prepare("SELECT id, label, labels FROM automation_rules").all() as Array<{ id: string; label: string; labels: string | null }>) {
    if (!row.labels) {
      try {
        db.prepare("UPDATE automation_rules SET labels = ? WHERE id = ?").run(JSON.stringify(normalizeGithubLabels(row.label).slice(0, 10)), row.id);
      } catch { /* best-effort backfill */ }
    }
  }
  // No continuity shims for pre-module rule shapes: rules carry labels,
  // authors, template, and start policy in their current columns, period.
  // Anything older re-saves through the dialog (parked drafts by default).
  const automationFireColumns = db.prepare("PRAGMA table_info(automation_rule_fires)").all() as Array<{ name: string }>;
  if (!automationFireColumns.some((column) => column.name === "outcome")) {
    db.exec("ALTER TABLE automation_rule_fires ADD COLUMN outcome TEXT");
  }
}

interface GithubIssueRef {
  repo: string;
  number: number;
  title: string;
  author: string;
  body: string;
  url: string;
  labels: string[];
  comments?: Array<{ author: string; body: string; createdAt: string }>;
}

// gh subprocess runner (taskboard precedent: same auth, no second token).
// Stderr carries the refusal; an empty stderr falls back to the exit error.
function execGh(path: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(path, args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr ?? "").trim() || error.message));
      else resolve(stdout);
    });
  });
}

export function createGithubAutomation(ctx: GithubAutomationDeps) {
  const { db, bb } = ctx;
  const now = () => ctx.now();
  const automationWarned = new Set<string>();

  function requireEnabled(): void {
    if (!githubIssuesEnabled()) throw new Error("GitHub issues are disabled on this host (STELOW_GITHUB_ISSUES=0).");
  }

  // Thin typed wrapper over the builtin `github` plugin's RPC. The github
  // plugin owns its auth/sync/cache; Stelow only reads tagged issues and
  // (optionally) clears the tag after import.
  const g = {
    status: () =>
      bb.sdk.plugins.callRpc<{ ghOk: boolean; ghState: string; repos: Array<{ repo: string; projectId: string | null }>; lastSyncedAt: string | null }>({
        pluginId: "github",
        method: "status",
        input: null,
        outputSchema: z.any(),
      }),
    listItems: (input: { kind?: "issue" | "pr"; state?: "open" | "closed"; repo?: string }) =>
      bb.sdk.plugins.callRpc<{ items: Array<{ repo: string; number: number; kind: string; title: string; state: string; author: string; labels: string[]; url: string; body: string; updatedAt: string }> }>({
        pluginId: "github",
        method: "listItems",
        input: { state: "open", ...input },
        outputSchema: z.any(),
      }),
    getIssue: (input: { repo: string; number: number }) =>
      bb.sdk.plugins.callRpc<{ issue: { repo: string; number: number; title: string; state: string; author: string; body: string; labels: string[]; url: string; updatedAt: string; comments: Array<{ author: string; body: string; createdAt: string }> } }>({
        pluginId: "github",
        method: "getIssue",
        input,
        outputSchema: z.any(),
      }),
    setLabels: (input: { repo: string; number: number; labels: string[] }) =>
      bb.sdk.plugins.callRpc<{ ok: boolean; labels: string[] }>({
        pluginId: "github",
        method: "setLabels",
        input,
        outputSchema: z.any(),
      }),
    assignableUsers: (input: { repo: string }) =>
      bb.sdk.plugins.callRpc<{ users: string[] }>({
        pluginId: "github",
        method: "assignableUsers",
        input,
        outputSchema: z.any(),
      }),
    repositoryLabels: (input: { repo: string }) =>
      bb.sdk.plugins.callRpc<{ labels: string[] }>({
        pluginId: "github",
        method: "repositoryLabels",
        input,
        outputSchema: z.any(),
      }),
    commentIssue: (input: { repo: string; number: number; body: string }) =>
      bb.sdk.plugins.callRpc<{ ok: boolean }>({
        pluginId: "github",
        method: "commentIssue",
        input,
        outputSchema: z.any(),
      }),
    setIssueState: (input: { repo: string; number: number; state: "open" | "closed" }) =>
      bb.sdk.plugins.callRpc<{ ok: boolean }>({
        pluginId: "github",
        method: "setIssueState",
        input,
        outputSchema: z.any(),
      }),
  };

  // Availability + auth of the builtin `github` plugin. Never throws.
  async function githubStatusResolved() {
    try {
      const status = await g.status();
      return { ok: true, pluginAvailable: true, ghOk: Boolean(status.ghOk), repos: status.repos ?? [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const pluginMissing = /plugin.*(not.*found|missing|unavailable)|github.*not/i.test(message);
      return { ok: pluginMissing, pluginAvailable: false, ghOk: false, repos: [] as Array<{ repo: string; projectId: string | null }> };
    }
  }

  // Per-repo picker data (assignable users, repo labels). Fail-soft per
  // repo: one rejection never empties the pickers.
  async function githubPickers(repos: string[]): Promise<{ labels: string[]; assignees: string[] }> {
    const labelLists: unknown[] = [];
    const userLists: unknown[] = [];
    await Promise.all(repos.map(async (repo) => {
      try {
        const result = await g.repositoryLabels({ repo });
        labelLists.push(result.labels);
      } catch { /* repo unreachable — derived lists still cover it */ }
      try {
        const result = await g.assignableUsers({ repo });
        userLists.push(result.users);
      } catch { /* same */ }
    }));
    return { labels: sortedUnion(labelLists), assignees: sortedUnion(userLists) };
  }

  // A curated issue reference for the card prompt, so the worker reads the
  // issue without re-fetching GitHub. Body + comments give the triage context.
  function githubIssuePrompt(issue: GithubIssueRef, comments: Array<{ author: string; body: string; createdAt: string }> = []): string {
    const lines = [
      `GitHub issue ${issue.repo}#${issue.number}: ${issue.title}`,
      `Author: ${issue.author}`,
      `Labels: ${issue.labels.join(", ") || "none"}`,
      `URL: ${issue.url}`,
      "",
      issue.body.trim() ? `Description:\n${issue.body.trim()}` : "(no description)",
    ];
    if (comments.length > 0) {
      lines.push("", "Comments:");
      for (const comment of comments) lines.push(`- ${comment.author}: ${comment.body.trim()}`);
    }
    return lines.join("\n");
  }

  function ruleLabelsOf(row: Record<string, unknown>): string[] {
    const fromJson = (() => {
      if (typeof row.labels !== "string" || !row.labels) return null;
      try {
        const parsed: unknown = JSON.parse(row.labels);
        const clean = normalizeGithubLabels(parsed);
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
      return normalizeGithubAuthors(JSON.parse(row.trusted_authors));
    } catch {
      return normalizeGithubAuthors(row.trusted_authors);
    }
  }

  function toRuleSnapshot(row: { id: string; project_id: string; enabled: number; created_at: number; updated_at: number } & Record<string, unknown>) {
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

  // Default New-worktree preset for auto-started GitHub workers: default
  // first, then alphabetical. Null means no isolated preset exists.
  const resolveWorktreePreset = (): string | null => ctx.presets.getWorktreePresetId();

  function seenAutomationKeys(ruleId: string): Set<string> {
    return new Set(
      (db.prepare("SELECT source_key FROM automation_rule_seen WHERE rule_id = ?").all(ruleId) as Array<{ source_key: string }>).map((row) => row.source_key),
    );
  }

  // Liveness behind the single dedupe lives in lib/github-claims.mjs
  // (tested): cardless, claimless rows read as not-imported so a deleted
  // card's issue can come back.

  // Effective spawn environment for GitHub-created build cards: the
  // band-routed preset wins over any passed preset at spawn time, so the
  // gate must check this — never mere preset existence.
  const effectiveGithubSpawnEnvKind = (): string =>
    ctx.presets.getEffectiveBuildEnvironmentKind();

  // Backlog guard: record currently-matching issues as seen without
  // creating cards, so enabling a rule only drafts genuinely new issues.
  // Throws on GitHub failure so the caller saves disabled instead of
  // firing blind on the full backlog next tick.
  async function primeAutomationRule(ruleId: string, projectId: string, labels: string[], trustedAuthors: string[]): Promise<number> {
    const items = await g.listItems({ kind: "issue", state: "open" });
    const github = await githubStatusResolved().catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }));
    const projectForRepo = new Map(github.repos.map((entry) => [entry.repo, entry.projectId]));
    const firedKeys = new Set(
      (db.prepare("SELECT source_key FROM automation_rule_fires WHERE rule_id = ?").all(ruleId) as Array<{ source_key: string }>).map((row) => row.source_key),
    );
    const matches = matchAutomationIssues(items.items, { labels, trustedAuthors, projectId, projectForRepo, firedKeys, seenKeys: seenAutomationKeys(ruleId), importedKeys: liveImportedKeys(db) });
    const ts = now();
    for (const match of matches) {
      db.prepare("INSERT OR IGNORE INTO automation_rule_seen (rule_id, source_key, seen_at) VALUES (?, ?, ?)").run(ruleId, match.key, ts);
    }
    return matches.length;
  }

  // Shared GitHub issue → card path (manual import + automation rules).
  // Claim-first with an owner token (lib/github-claims.mjs, tested):
  // concurrent flows cannot both pass the dedupe check — the loser sees
  // already-imported or in-flight instead of orphaning a second card.
  async function createCardFromGithub({ projectId, repo, number: numberValue, triggerLabels, start, presetId, rulePrompt }: { projectId: string; repo: string; number: number; triggerLabels: string[]; start: boolean; presetId?: string | null; rulePrompt?: string | null }): Promise<{ cardId: string | null; skipped: string | null }> {
    const key = `${repo}#${numberValue}`;
    const fast = db.prepare("SELECT card_id FROM github_imports WHERE issue_key = ?").get(key) as { card_id: string | null } | undefined;
    if (fast?.card_id && ctx.cards.get(fast.card_id)) return { cardId: fast.card_id, skipped: "already-imported" };
    const token = ctx.randomId("claim");
    const claim = acquireGithubImportClaim(db, { key, repo, number: numberValue, label: triggerLabels[0] ?? "", token, now: now() });
    if (!claim.owned) {
      if (claim.cardId && ctx.cards.get(claim.cardId)) return { cardId: claim.cardId, skipped: "already-imported" };
      return { cardId: null, skipped: "in-flight" };
    }
    try {
      const { issue } = await g.getIssue({ repo, number: numberValue }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "GitHub plugin unavailable";
        throw new Error(`GitHub import unavailable: ${message}`);
      });
      const prompt = applyRulePrompt(githubIssuePrompt(issue, issue.comments), rulePrompt);
      const intent = githubIntentFor({ labels: issue.labels, title: issue.title });
      const card = await ctx.cards.create({ projectId, prompt, attachments: [], intent, appetite: "Lean", reviewMode: "Auto", presetId: presetId ?? null, start });
      if (!completeGithubImport(db, { key, token, cardId: card.cardId, label: triggerLabels[0] ?? "", now: now() })) {
        // Defensive convergence only (unreachable while the claim holds:
        // link OUR card without the token guard so any retry finds a live
        // card and converges to already-imported instead of orphaning a
        // second one. Overwriting a rival link is impossible here — a rival
        // could only complete with its own token, which the claim excludes.
        db.prepare("UPDATE github_imports SET card_id = ?, label = ?, imported_at = ?, claimed_by = NULL WHERE issue_key = ?").run(card.cardId, triggerLabels[0] ?? "", now(), key);
        bb.log.warn(`github import ${key} completed without its claim; linked defensively`);
      }
      await g.setLabels({ repo, number: numberValue, labels: issue.labels.filter((item) => !triggerLabels.includes(item)) }).catch(() => {});
      return { cardId: card.cardId, skipped: null };
    } finally {
      releaseGithubClaim(db, { key, token });
    }
  }

  async function runSingleAutomationRule(
    row: { id: string; project_id: string } & Record<string, unknown>,
    items: Array<{ repo: string; number: number; labels: string[] }>,
    projectForRepo: Map<string, string | null>,
    importedKeys: Set<string>,
  ): Promise<void> {
    const labels = ruleLabelsOf(row);
    if (labels.length === 0) return;
    const trustedAuthors = ruleAuthorsOf(row);
    const rulePrompt = rulePromptOf(row);
    const startImmediate = Number(row.start_immediate ?? 0) === 1;
    const firedKeys = new Set(
      (db.prepare("SELECT source_key FROM automation_rule_fires WHERE rule_id = ?").all(row.id) as Array<{ source_key: string }>).map((entry) => entry.source_key),
    );
    const matches = matchAutomationIssues(items, { labels, trustedAuthors, projectId: row.project_id, projectForRepo, firedKeys, seenKeys: seenAutomationKeys(row.id), importedKeys }).slice(0, 10);
    if (matches.length === 0) return;
    // Gate on the EFFECTIVE spawn environment (band routing wins over any
    // passed preset): auto-start parks unless the worker would actually
    // run isolated. Re-checked every tick — the preset may vanish later.
    const decision = decideAutomationSpawn({ startImmediate, effectiveEnvKind: effectiveGithubSpawnEnvKind() });
    const worktreePreset = decision.start ? resolveWorktreePreset() : null;
    if (decision.parkedReason) {
      const warnKey = `${row.id}:parked:${labels.join("+")}`;
      if (!automationWarned.has(warnKey)) {
        automationWarned.add(warnKey);
        bb.log.warn(`automation rule ${row.id} parked ${matches.length} matches: ${describeParkedReason(decision.parkedReason)}`);
      }
    }
    for (const match of matches) {
      try {
        const created = await createCardFromGithub({ projectId: row.project_id, repo: match.repo, number: match.number, triggerLabels: labels, start: decision.start, presetId: worktreePreset, rulePrompt });
        if (created.skipped === "in-flight" || !created.cardId) continue;
        const card = ctx.cards.get(created.cardId);
        if (card) {
          const note = decision.start ? "Started in an isolated worktree" : "Drafted";
          const fallback = decision.parkedReason ? ` (${describeParkedReason(decision.parkedReason)})` : "";
          ctx.cards.comment(card.id, "card", card.id, "agent", `${note} from GitHub issue #${match.number} (rule ${labels.join(" + ")})${fallback}`);
        }
        db.prepare("INSERT OR IGNORE INTO automation_rule_fires (rule_id, source_key, card_id, fired_at, outcome) VALUES (?, ?, ?, ?, ?)").run(row.id, match.key, created.cardId, now(), decision.start ? "started" : created.skipped === "already-imported" ? "already-imported" : "parked");
        importedKeys.add(match.key);
        bb.realtime.publish("board-changed", { reason: "automation-draft", cardId: created.cardId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Persistent config states (repo with no BB project yet) retry
        // silently after one warning — self-healing, no 5-minute spam.
        const warnKey = `${row.id}:${match.key}:${message}`;
        if (!automationWarned.has(warnKey)) {
          automationWarned.add(warnKey);
          bb.log.warn(`automation rule ${row.id} skipped ${match.key}: ${message}`);
        }
      }
    }
  }

  async function runAutomationRules(): Promise<void> {
    if (!githubIssuesEnabled()) return;
    const rows = db.prepare("SELECT * FROM automation_rules WHERE enabled = 1").all() as Array<{ id: string; project_id: string } & Record<string, unknown>>;
    if (rows.length === 0) return;
    const items = await g.listItems({ kind: "issue", state: "open" }).catch(() => null);
    if (!items) return;
    const github = await githubStatusResolved().catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }));
    const projectForRepo = new Map(github.repos.map((entry) => [entry.repo, entry.projectId]));
    const importedKeys = liveImportedKeys(db);
    for (const row of rows) {
      await runSingleAutomationRule(row, items.items, projectForRepo, importedKeys);
    }
  }

  const handlers = {
    async listAutomationRules({ projectId }: { projectId: string | null }) {
      requireEnabled();
      if (!projectId) return { rules: [] };
      const rows = db.prepare("SELECT * FROM automation_rules WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Array<{ id: string; project_id: string; enabled: number; created_at: number; updated_at: number } & Record<string, unknown>>;
      return { rules: rows.map((rule) => toRuleSnapshot(rule)) };
    },

    async saveAutomationRule({ id, projectId, labels, label, trustedAuthors, promptTemplate, enabled, startImmediate }: { id?: string | null; projectId: string; labels?: string[]; label?: string; trustedAuthors?: string[] | string; promptTemplate?: string; enabled: boolean; startImmediate: boolean }) {
      requireEnabled();
      const clean = normalizeGithubLabels(labels ?? label);
      if (clean.length === 0) throw new Error("Rule needs at least one label.");
      const authors = normalizeGithubAuthors(trustedAuthors ?? []);
      const template = typeof promptTemplate === "string" ? promptTemplate.trim().slice(0, 2_000) : "";
      // Fail closed on isolation through the same gate the tick uses: the
      // EFFECTIVE spawn environment (band routing wins), never mere preset
      // existence. Every refusal names the exit.
      const gate = decideAutomationSpawn({ startImmediate, effectiveEnvKind: effectiveGithubSpawnEnvKind() });
      if (startImmediate && !gate.start) {
        throw new Error(`Auto-start refused: ${describeParkedReason(gate.parkedReason)}. Create a New-worktree preset in Agent Presets, or uncheck Start immediately to park drafts instead.`);
      }
      const ts = now();
      const ruleId = id ?? ctx.randomId("rule");
      const existing = db.prepare("SELECT created_at, prompt_template, trusted_authors FROM automation_rules WHERE id = ?").get(ruleId) as { created_at: number; prompt_template: string | null; trusted_authors: string | null } | undefined;
      const createdAt = existing?.created_at ?? ts;
      // Absent template/authors keep the stored value so the enable toggle
      // never wipes them.
      const storedTemplate = promptTemplate === undefined ? (existing?.prompt_template ?? "") : template;
      const storedAuthors = trustedAuthors === undefined ? (existing?.trusted_authors ?? null) : (authors.length > 0 ? JSON.stringify(authors) : null);
      db.prepare("INSERT INTO automation_rules (id, project_id, label, labels, trusted_authors, prompt_template, enabled, start_immediate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, labels = excluded.labels, trusted_authors = excluded.trusted_authors, prompt_template = excluded.prompt_template, enabled = excluded.enabled, start_immediate = excluded.start_immediate, updated_at = excluded.updated_at")
        .run(ruleId, projectId, clean[0], JSON.stringify(clean), storedAuthors, storedTemplate, enabled ? 1 : 0, startImmediate ? 1 : 0, createdAt, ts);
      // Backlog guard: an enabled rule records current matches as seen
      // without creating cards. On GitHub failure the rule is saved
      // DISABLED instead of firing blind on the backlog next tick.
      let primed = 0;
      if (enabled) {
        try {
          primed = await primeAutomationRule(ruleId, projectId, clean, authors);
        } catch (error) {
          db.prepare("UPDATE automation_rules SET enabled = 0, updated_at = ? WHERE id = ?").run(now(), ruleId);
          const message = error instanceof Error ? error.message : "GitHub unreachable";
          throw new Error(`Rule saved disabled (${message}). Re-enable to prime the backlog and go live.`);
        }
      }
      const saved = db.prepare("SELECT * FROM automation_rules WHERE id = ?").get(ruleId) as { id: string; project_id: string; enabled: number; created_at: number; updated_at: number } & Record<string, unknown>;
      return { rule: toRuleSnapshot(saved), primed };
    },

    async previewAutomationRule({ projectId, labels, label, trustedAuthors }: { projectId: string; labels?: string[]; label?: string; trustedAuthors?: string[] | string }) {
      requireEnabled();
      const clean = normalizeGithubLabels(labels ?? label);
      if (clean.length === 0) throw new Error("Pick at least one label to preview.");
      const authors = normalizeGithubAuthors(trustedAuthors ?? []);
      const items = await g.listItems({ kind: "issue", state: "open" }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "GitHub plugin unavailable";
        throw new Error(`GitHub preview unavailable: ${message}`);
      });
      const status = await githubStatusResolved().catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }));
      const projectForRepo = new Map(status.repos.map((entry) => [entry.repo, entry.projectId]));
      const byKey = new Map(items.items.map((item) => [`${item.repo}#${item.number}`, item]));
      const firedKeys = new Set<string>();
      const seenKeys = new Set<string>();
      for (const row of db.prepare("SELECT id FROM automation_rules WHERE project_id = ?").all(projectId) as Array<{ id: string }>) {
        for (const key of db.prepare("SELECT source_key FROM automation_rule_fires WHERE rule_id = ?").all(row.id) as Array<{ source_key: string }>) firedKeys.add(key.source_key);
        for (const key of seenAutomationKeys(row.id)) seenKeys.add(key);
      }
      const { matches, skipped } = previewAutomationMatches(items.items, { labels: clean, trustedAuthors: authors, projectId, projectForRepo, firedKeys, seenKeys, importedKeys: liveImportedKeys(db) });
      const titleOf = (key: string): { title: string; url: string; author: string } => {
        const item = byKey.get(key);
        return { title: item?.title ?? key, url: item?.url ?? "", author: item?.author ?? "" };
      };
      return {
        matches: matches.slice(0, 50).map((entry) => ({ repo: entry.repo, number: entry.number, ...titleOf(entry.key) })),
        skipped: skipped.slice(0, 50).map((entry) => ({ repo: entry.repo, number: entry.number, ...titleOf(entry.key), reason: entry.reason, owner: entry.owner ?? null })),
        checkedAt: now(),
      };
    },

    async listAutomationRuleRuns({ ruleId, limit }: { ruleId: string; limit: number }) {
      requireEnabled();
      const rows = db.prepare("SELECT f.source_key, f.card_id, f.fired_at, f.outcome, g.repo, g.number FROM automation_rule_fires f LEFT JOIN github_imports g ON g.issue_key = f.source_key WHERE f.rule_id = ? ORDER BY f.fired_at DESC LIMIT ?").all(ruleId, limit) as Array<{ source_key: string; card_id: string; fired_at: number; outcome: string | null; repo: string | null; number: number | null }>;
      return {
        runs: rows.map((row) => {
          const card = ctx.cards.get(row.card_id);
          const [repo, number] = row.repo !== null && row.number !== null
            ? [row.repo, row.number]
            : [String(row.source_key.split("#")[0] ?? row.source_key), Number(row.source_key.split("#")[1] ?? 0)];
          return { sourceKey: row.source_key, repo, number, cardId: row.card_id, cardName: card ? (card.display_name ?? card.name) : null, cardStatus: card ? ctx.cards.normalizeStatus(card.status) : null, outcome: row.outcome, firedAt: row.fired_at };
        }),
      };
    },

    async deleteAutomationRule({ id }: { id: string }) {
      requireEnabled();
      db.prepare("DELETE FROM automation_rules WHERE id = ?").run(id);
      return { ok: true };
    },

    async listGithubCandidates({ labels, label }: { labels?: string[]; label?: string }) {
      requireEnabled();
      const watched = normalizeGithubLabels(labels ?? label);
      if (watched.length === 0) throw new Error("Pick at least one label.");
      // Safely reject when the github plugin is not available so the UI can
      // show a real reason instead of an empty list. The wrapper's rejection
      // message carries the pluginId/method for the user.
      const items = await g.listItems({ kind: "issue", state: "open" }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "GitHub plugin unavailable";
        throw new Error(`GitHub import unavailable: ${message}`);
      });
      // Resolve each issue to the bb project that owns its repo (GitHub plugin
      // maps repo -> projectId from git remotes), so the UI needs no project
      // picker. Unmapped repos fall back to the caller's active project.
      const status = await githubStatusResolved().catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }));
      const repoToProject = new Map(status.repos.map((entry) => [entry.repo, entry.projectId]));
      const strList = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
      // Alphabetical pickers over EXISTING things, not just what's on open
      // issues: assignable users and repo labels per tracked repo (fail-soft
      // per repo), merged with whatever the cached issues already carry so
      // the pickers stay useful even when no open issue has an assignee.
      const pickerLists = await githubPickers(status.repos.map((entry) => entry.repo));
      const allLabels = sortedUnion([pickerLists.labels, items.items.flatMap((item) => strList(item.labels))]);
      const allAssignees = sortedUnion([pickerLists.assignees, items.items.flatMap((item) => strList((item as { assignees?: unknown }).assignees))]);
      const issues = items.items
        .filter((item) => watched.every((entry) => item.labels.includes(entry)))
        .sort((a, b) => Number(b.number) - Number(a.number));
      return {
        allLabels,
        allAssignees,
        issues: issues.map((issue) => {
          const key = `${issue.repo}#${issue.number}`;
          const link = db.prepare("SELECT card_id, commented_at FROM github_imports WHERE issue_key = ?").get(key) as { card_id: string | null; commented_at: number | null } | undefined;
          const card = link?.card_id ? (ctx.cards.get(link.card_id) ?? null) : null;
          // A link without a live card (deleted card, released crash) reads
          // as not-imported so the issue can come back.
          const imported = card !== null;
          return {
            repo: issue.repo,
            number: issue.number,
            title: issue.title,
            labels: issue.labels,
            author: issue.author,
            assignees: strList((issue as { assignees?: unknown }).assignees),
            url: issue.url,
            body: issue.body,
            updatedAt: issue.updatedAt,
            projectId: repoToProject.get(issue.repo) ?? null,
            alreadyImported: imported,
            cardId: card?.id ?? null,
            cardName: card ? (card.display_name ?? card.name) : null,
            cardStatus: card ? ctx.cards.normalizeStatus(card.status) : null,
            postedAt: link?.commented_at ?? null,
            related: findRelatedIssues(issue, items.items),
          };
        }),
      };
    },

    async importGithubIssue({ projectId, repo, number: numberValue, labels, label, start, isolated }: { projectId?: string | null; repo: string; number: number; labels?: string[]; label?: string; start: boolean; isolated?: boolean }) {
      requireEnabled();
      const triggerLabels = normalizeGithubLabels(labels ?? label);
      // Isolated start reuses the automation isolation gate (same rule,
      // same redirect): a worktree preset must effectively win, or the
      // import refuses instead of silently landing in the checkout.
      let presetId: string | null = null;
      if (isolated) {
        const gate = decideAutomationSpawn({ startImmediate: true, effectiveEnvKind: effectiveGithubSpawnEnvKind() });
        if (!gate.start) {
          throw new Error(`Isolated start refused: ${describeParkedReason(gate.parkedReason)}. Create a New-worktree preset in Agent Presets, or uncheck Isolated worktree to import into the project checkout instead.`);
        }
        presetId = resolveWorktreePreset();
      }
      // Resolve the owning project from the repo (fall back to the caller's
      // active project) when the caller didn't pass one explicitly.
      let resolvedProjectId = projectId;
      if (!resolvedProjectId) {
        const status = await githubStatusResolved().catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }));
        const match = status.repos.find((entry) => entry.repo === repo);
        resolvedProjectId = match?.projectId ?? null;
      }
      if (!resolvedProjectId) throw new Error(`Cannot determine the bb project for repo ${repo}; open it as a project in bb first.`);
      const created = await createCardFromGithub({ projectId: resolvedProjectId, repo, number: numberValue, triggerLabels, start, presetId });
      // An isolated request that parks must survive until the later Start:
      // pin the worktree preset as this card's override now, or the choice
      // evaporates and the worker lands in the checkout it was meant to avoid.
      if (created.cardId && presetId && !start) {
        const pinned = ctx.presets.pinCardPreset(created.cardId, presetId);
        if (!pinned) throw new Error("Isolated start refused: the worktree preset no longer exists. Choose a New-worktree preset and try again.");
      }
      if (created.cardId) bb.realtime.publish("card-state", { cardId: created.cardId });
      return { ok: true, cardId: created.cardId, skipped: created.skipped, error: null };
    },

    async postGithubCompletion({ cardId, closeIssue }: { cardId: string; closeIssue: boolean }) {
      requireEnabled();
      // Explicit, user-triggered write-back for imported issues: posts a
      // factual English completion summary as an issue comment, optionally
      // closing the issue. Never automatic — Done in Stelow is not
      // merged/deployed, so auto-close would lie. Uses the github plugin's
      // own RPCs (same auth it syncs with), never shelling out.
      const card = ctx.cards.get(cardId);
      if (!card) return { ok: false, issueUrl: null, error: "Card not found." };
      const link = db.prepare("SELECT repo, number FROM github_imports WHERE card_id = ?").get(cardId) as { repo: string; number: number } | undefined;
      if (!link) return { ok: false, issueUrl: null, error: "This card was not imported from a GitHub issue." };
      if (ctx.cards.normalizeStatus(card.status) !== "completed") return { ok: false, issueUrl: null, error: "Only completed cards can report back to GitHub." };
      const workspace = await ctx.cards.workspace(card).catch(() => null);
      const scopes = ctx.cards.scopes(card, workspace?.path ?? null);
      const doneScopes = scopes.filter((scope) => ["done", "completed"].includes(scope.status)).length;
      const tasksTotal = scopes.reduce((total, scope) => total + scope.tasks.length, 0);
      const tasksDone = scopes.reduce((total, scope) => total + scope.tasks.filter((task) => ["done", "completed"].includes(task.status)).length, 0);
      const scopeLines = scopes.map((scope) => `- ${scope.name} (${ctx.cards.statusLabel(scope.status)}${scope.tasks.length > 0 ? `, ${scope.tasks.filter((task) => ["done", "completed"].includes(task.status)).length}/${scope.tasks.length} tasks` : ""})`);
      const marker = markerFor(cardId);
      const body = [
        `Stelow completed "${card.display_name ?? card.name}" (intent: ${card.intent}, final stage: ${card.stage}).`,
        ``,
        scopes.length > 0 ? `Scopes: ${doneScopes}/${scopes.length} done; tasks: ${tasksDone}/${tasksTotal} done.` : `No scopes tracked.`,
        ...scopeLines,
        ``,
        `Prompt: ${card.prompt.length > 500 ? `${card.prompt.slice(0, 500)}…` : card.prompt}`,
        marker,
      ].join("\n");
      const issueUrl = `https://github.com/${link.repo}/issues/${link.number}`;
      // Idempotency first: a previous attempt may have posted before
      // recording. If the marker is already there, adopt it — retrying
      // must never double-post.
      const before = await g.getIssue({ repo: link.repo, number: link.number }).catch(() => null);
      if (before && carriesMarker(before.issue.comments, marker)) {
        db.prepare("UPDATE github_imports SET commented_at = ? WHERE card_id = ?").run(now(), cardId);
        return { ok: true, issueUrl, error: null };
      }
      try {
        await g.commentIssue({ repo: link.repo, number: link.number, body });
      } catch (error) {
        return { ok: false, issueUrl: null, error: error instanceof Error ? error.message : "Could not comment on the GitHub issue." };
      }
      const after = await g.getIssue({ repo: link.repo, number: link.number }).catch(() => null);
      if (!after || !carriesMarker(after.issue.comments, marker)) {
        return { ok: false, issueUrl, error: "Comment sent but not found back on the issue — check it on GitHub before retrying (retrying never double-posts)." };
      }
      // Record before the optional close: a close failure must never
      // invite a retry that posts the comment twice.
      db.prepare("UPDATE github_imports SET commented_at = ? WHERE card_id = ?").run(now(), cardId);
      if (closeIssue) {
        try {
          await g.setIssueState({ repo: link.repo, number: link.number, state: "closed" });
        } catch {
          return { ok: false, issueUrl, error: "Comment posted, but the automatic close failed — close the issue manually on GitHub." };
        }
      }
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, issueUrl, error: null };
    },

    async createLinkedGithubIssue({ cardId, repo }: { cardId: string; repo?: string | null }) {
      requireEnabled();
      const card = db.prepare("SELECT id, display_name, name, prompt, project_id, status FROM cards WHERE id = ?").get(cardId) as
        { id: string; display_name: string | null; name: string; prompt: string; project_id: string; status: string } | undefined;
      if (!card) return { ok: false, url: null, number: null, error: "Card not found." };
      if (ctx.cards.normalizeStatus(card.status) === "archived") return { ok: false, url: null, number: null, error: "This card is archived." };
      // Idempotent: a linked card returns its link instead of creating twice.
      const existing = db.prepare("SELECT repo, number FROM github_imports WHERE card_id = ?").get(cardId) as { repo: string; number: number } | undefined;
      if (existing) return { ok: true, url: `https://github.com/${existing.repo}/issues/${existing.number}`, number: existing.number, error: null };
      const status = await githubStatusResolved().catch(() => ({ ok: false, pluginAvailable: false, ghOk: false, repos: [] as Array<{ repo: string; projectId: string | null }> }));
      if (!status.ghOk) return { ok: false, url: null, number: null, error: "GitHub is not connected — set up GitHub auth first." };
      const mapped = status.repos.filter((entry) => entry.projectId === card.project_id).map((entry) => entry.repo);
      const resolved = resolveTargetRepo({ mapped, requested: repo ?? null });
      if (!resolved.ok || !resolved.repo) return { ok: false, url: null, number: null, error: resolved.error };
      const target = resolved.repo;
      const title = (card.display_name ?? card.name ?? "").trim() || `Card ${card.id}`;
      let ghPath: string;
      try {
        ghPath = await resolveGhPath(async (candidate) => {
          await execGh(candidate, ["--version"]);
          return true;
        });
      } catch {
        return { ok: false, url: null, number: null, error: "GitHub CLI (gh) is not available on the host." };
      }
      let raw: string;
      try {
        raw = await execGh(ghPath, buildCreateIssueArgs({ repo: target, title, body: issueBodyForCard({ prompt: card.prompt, cardId }) }));
      } catch (error) {
        return { ok: false, url: null, number: null, error: error instanceof Error && error.message ? `GitHub refused the issue: ${error.message}` : "GitHub refused the issue." };
      }
      let parsed: { number: number; url: string };
      try {
        parsed = parseCreateIssueResponse(raw);
      } catch (error) {
        return { ok: false, url: null, number: null, error: error instanceof Error ? error.message : "GitHub may have created the issue but the response was unreadable." };
      }
      db.prepare("INSERT OR IGNORE INTO github_imports (issue_key, repo, number, label, card_id, imported_at) VALUES (?,?,?,?,?,?)")
        .run(issueKey(target, parsed.number), target, parsed.number, "", cardId, now());
      return { ok: true, url: parsed.url, number: parsed.number, error: null };
    },

    async getLinkedDiscussion({ cardId }: { cardId: string }) {
      requireEnabled();
      // Eligibility for the create CTA doubles as the unlinked shape: any
      // non-archived card on a mapped project can link, on any track.
      const link = db.prepare("SELECT repo, number FROM github_imports WHERE card_id = ?").get(cardId) as { repo: string; number: number } | undefined;
      if (!link) {
        const card = db.prepare("SELECT project_id, status FROM cards WHERE id = ?").get(cardId) as { project_id: string; status: string } | undefined;
        if (!card || ctx.cards.normalizeStatus(card.status) === "archived") {
          return { linked: false, repo: null, number: null, url: null, comments: [], updatedAt: null, canCreate: false, repos: [] as string[] };
        }
        const status = await githubStatusResolved().catch(() => ({ ok: false, pluginAvailable: false, ghOk: false, repos: [] as Array<{ repo: string; projectId: string | null }> }));
        const repos = status.ghOk ? status.repos.filter((entry) => entry.projectId === card.project_id).map((entry) => entry.repo) : [];
        return { linked: false, repo: null, number: null, url: null, comments: [], updatedAt: null, canCreate: repos.length > 0, repos };
      }
      const url = `https://github.com/${link.repo}/issues/${link.number}`;
      const readStored = () => {
        const rows = db.prepare("SELECT author, body, created_at, fetched_at FROM github_issue_comments WHERE card_id = ? ORDER BY created_at ASC").all(cardId) as
          Array<{ author: string; body: string; created_at: number; fetched_at: number }>;
        return {
          linked: true, repo: link.repo, number: link.number, url, canCreate: false, repos: [] as string[],
          comments: rows.map((row) => ({ author: row.author, body: row.body, createdAt: row.created_at })),
          updatedAt: rows.length > 0 ? Math.max(...rows.map((row) => row.fetched_at)) : null,
        };
      };
      // Terminal cards serve the frozen snapshot: their record is history.
      const card = db.prepare("SELECT status FROM cards WHERE id = ?").get(cardId) as { status: string } | undefined;
      const terminal = card ? ["completed", "archived"].includes(ctx.cards.normalizeStatus(card.status)) : false;
      if (!terminal) {
        try {
          const issue = await g.getIssue({ repo: link.repo, number: link.number });
          const rows = toMirrorRows(cardId, issue.issue.comments, now());
          const insert = db.prepare("INSERT OR IGNORE INTO github_issue_comments (id, card_id, author, body, created_at, fetched_at) VALUES (?,?,?,?,?,?)");
          let inserted = 0;
          for (const row of rows) inserted += insert.run(row.id, row.card_id, row.author, row.body, row.created_at, row.fetched_at).changes;
          if (inserted > 0) bb.realtime.publish("github-discussion", { cardId });
        } catch (error) {
          bb.log.warn(`linked discussion refresh failed for ${cardId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return readStored();
    },

    // Human-gated write-back (the composer confirms destination and text):
    // workers never reach this through UI, and the server enforces the
    // payload anyway — trust the gesture, verify the payload.
    async postIssueComment({ cardId, body }: { cardId: string; body: string }) {
      requireEnabled();
      const checked = validatePostBody(body);
      if (!checked.ok) return { ok: false, error: checked.error };
      const link = db.prepare("SELECT repo, number FROM github_imports WHERE card_id = ?").get(cardId) as { repo: string; number: number } | undefined;
      if (!link) return { ok: false, error: "This card has no linked GitHub issue." };
      const card = db.prepare("SELECT status FROM cards WHERE id = ?").get(cardId) as { status: string } | undefined;
      if (card && ctx.cards.normalizeStatus(card.status) === "archived") return { ok: false, error: "This card is archived." };
      try {
        await g.commentIssue({ repo: link.repo, number: link.number, body: checked.text });
      } catch (error) {
        return { ok: false, error: error instanceof Error && error.message ? `GitHub refused the comment: ${error.message}` : "GitHub refused the comment." };
      }
      // Best-effort mirror refresh so the post reads back instantly; the
      // next fetch converges regardless.
      try {
        const issue = await g.getIssue({ repo: link.repo, number: link.number });
        const rows = toMirrorRows(cardId, issue.issue.comments, now());
        const insert = db.prepare("INSERT OR IGNORE INTO github_issue_comments (id, card_id, author, body, created_at, fetched_at) VALUES (?,?,?,?,?,?)");
        let inserted = 0;
        for (const row of rows) inserted += insert.run(row.id, row.card_id, row.author, row.body, row.created_at, row.fetched_at).changes;
        if (inserted > 0) bb.realtime.publish("github-discussion", { cardId });
      } catch { /* the post succeeded; the next fetch converges */ }
      return { ok: true, error: null };
    },
  };

  // Poll vehicle for the discussion mirror (own 5-minute schedule in
  // server.ts): linked, non-terminal cards only. Terminal cards keep their
  // frozen snapshot; viewing any card refreshes on open regardless.
  async function refreshLinkedDiscussions(): Promise<void> {
    if (!githubIssuesEnabled()) return;
    const links = db.prepare(
      "SELECT gi.repo AS repo, gi.number AS number, gi.card_id AS cardId FROM github_imports gi JOIN cards c ON c.id = gi.card_id WHERE gi.card_id IS NOT NULL AND c.status NOT IN ('completed','archived')",
    ).all() as Array<{ repo: string; number: number; cardId: string }>;
    for (const link of links) {
      try {
        const issue = await g.getIssue({ repo: link.repo, number: link.number });
        const rows = toMirrorRows(link.cardId, issue.issue.comments, now());
        const insert = db.prepare("INSERT OR IGNORE INTO github_issue_comments (id, card_id, author, body, created_at, fetched_at) VALUES (?,?,?,?,?,?)");
        let inserted = 0;
        for (const row of rows) inserted += insert.run(row.id, row.card_id, row.author, row.body, row.created_at, row.fetched_at).changes;
        if (inserted > 0) bb.realtime.publish("github-discussion", { cardId: link.cardId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const warnKey = `mirror:${link.repo}#${link.number}:${message}`;
        if (!automationWarned.has(warnKey)) {
          automationWarned.add(warnKey);
          bb.log.warn(`linked discussion mirror skipped ${link.repo}#${link.number}: ${message}`);
        }
      }
    }
  }

  return { runAutomationRules, refreshLinkedDiscussions, handlers, githubStatus: githubStatusResolved };
}
