/**
 * Pure matching core for GitHub-label automation rules.
 *
 * A rule watches one label inside one project: an open issue matches when
 * it carries the label AND its repo maps to the rule's project. Issues the
 * rule already fired on (by `repo#number` source key) never match twice, so
 * re-runs are idempotent without touching the database here — the caller
 * passes the fired keys it already read.
 *
 * Label matching is exact and case-sensitive: GitHub labels are exact
 * strings, and fuzzy matching would draft cards for near-miss labels the
 * user never asked to watch.
 */

export function ruleSourceKey(repo, number) {
  return `${repo}#${number}`;
}

export function matchAutomationIssues(issues, { label, projectId, projectForRepo, firedKeys }) {
  const fired = new Set(firedKeys ?? []);
  const matches = [];
  for (const issue of issues ?? []) {
    if (!issue || typeof issue !== "object") continue;
    const labels = Array.isArray(issue.labels) ? issue.labels : [];
    if (typeof label !== "string" || !label || !labels.includes(label)) continue;
    const owner = projectForRepo instanceof Map
      ? projectForRepo.get(issue.repo) ?? null
      : projectForRepo?.[issue.repo] ?? null;
    if (owner !== projectId) continue;
    const key = ruleSourceKey(issue.repo, issue.number);
    if (fired.has(key)) continue;
    matches.push({ repo: issue.repo, number: issue.number, key });
  }
  return matches;
}
