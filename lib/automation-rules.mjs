/**
 * Pure matching core for GitHub-label automation rules.
 *
 * A rule watches labels inside one project (AND semantics): an open issue
 * matches when it carries EVERY watched label AND its repo maps to the
 * rule's project. Issues the rule already fired on, already marked seen
 * (backlog guard), or already imported (by the shared github_imports table)
 * never match twice, so re-runs are idempotent without touching the
 * database here — the caller passes the key sets it already read.
 *
 * Label matching is exact and case-sensitive: GitHub labels are exact
 * strings, and fuzzy matching would draft cards for near-miss labels the
 * user never asked to watch. `label` (singular) is accepted as a compat
 * alias for `labels: [label]`.
 *
 * One decision function serves both consumers: the scheduler (matches
 * only) and the dry-run preview (matches + named reasons, SlopCop-check
 * style: every skip says exactly why).
 */

export function ruleSourceKey(repo, number) {
  return `${repo}#${number}`;
}

function normalizeWatched(options) {
  if (Array.isArray(options?.labels)) return options.labels.filter((entry) => typeof entry === "string" && entry);
  if (typeof options?.label === "string" && options.label) return [options.label];
  return [];
}

function ownerOf(issue, projectForRepo) {
  if (projectForRepo instanceof Map) return projectForRepo.get(issue.repo) ?? null;
  return projectForRepo?.[issue.repo] ?? null;
}

/**
 * Decide one issue. Returns { ok: true, key } or
 * { ok: false, key, reason } with reason one of
 * 'invalid-issue' | 'missing-labels' | 'untrusted-author' |
 * 'other-project' | 'already-fired' | 'already-imported'. `seen`
 * (backlog guard) folds into the already-fired set — same "never again"
 * semantics. An empty author allowlist means anyone (documented).
 */
export function decideAutomationIssue(issue, { watched, trustedAuthors, projectId, projectForRepo, fired, imported }) {
  if (!issue || typeof issue !== "object") return { ok: false, key: null, reason: "invalid-issue" };
  const key = ruleSourceKey(issue.repo, issue.number);
  const issueLabels = Array.isArray(issue.labels) ? issue.labels : [];
  if (!watched.every((entry) => issueLabels.includes(entry))) return { ok: false, key, reason: "missing-labels" };
  if (Array.isArray(trustedAuthors) && trustedAuthors.length > 0 && !trustedAuthors.includes(issue.author)) {
    return { ok: false, key, reason: "untrusted-author" };
  }
  if (ownerOf(issue, projectForRepo) !== projectId) return { ok: false, key, reason: "other-project" };
  if (fired.has(key)) return { ok: false, key, reason: "already-fired" };
  if (imported.has(key)) return { ok: false, key, reason: "already-imported" };
  return { ok: true, key };
}

function contextOf(options) {
  return {
    watched: normalizeWatched(options),
    trustedAuthors: Array.isArray(options?.trustedAuthors)
      ? options.trustedAuthors.filter((entry) => typeof entry === "string" && entry)
      : [],
    projectId: options?.projectId,
    projectForRepo: options?.projectForRepo,
    fired: new Set([...(options?.firedKeys ?? []), ...(options?.seenKeys ?? [])]),
    imported: new Set(options?.importedKeys ?? []),
  };
}

export function matchAutomationIssues(issues, options) {
  const ctx = contextOf(options);
  if (ctx.watched.length === 0) return [];
  const matches = [];
  for (const issue of issues ?? []) {
    const decision = decideAutomationIssue(issue, ctx);
    if (decision.ok) matches.push({ repo: issue.repo, number: issue.number, key: decision.key });
  }
  return matches;
}

export function previewAutomationMatches(issues, options) {
  const ctx = contextOf(options);
  const matches = [];
  const skipped = [];
  if (ctx.watched.length === 0) return { matches, skipped };
  for (const issue of issues ?? []) {
    const decision = decideAutomationIssue(issue, ctx);
    if (decision.key === null) continue;
    if (decision.ok) matches.push({ repo: issue.repo, number: issue.number, key: decision.key });
    else skipped.push({ repo: issue.repo, number: issue.number, key: decision.key, reason: decision.reason });
  }
  return { matches, skipped };
}
