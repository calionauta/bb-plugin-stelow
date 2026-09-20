/**
 * Shared GitHub issue → Stelow intent heuristic.
 *
 * Single source used by manual import and automation rules (DRY).
 * Exact, cheap, and user-correctable afterwards via updateCardIntent.
 */

const INTENT_ORDER = ["bugfix", "refactor", "feature", "new-product"];

export function githubIntentFor(issue) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  const title = typeof issue?.title === "string" ? issue.title : "";
  const lower = [...labels, title].join(" ").toLowerCase();
  if (/\bbugs?\b|\bdefects?\b|\bregression\b/.test(lower)) return "bugfix";
  if (/\brefactor\b|\bclean(up)?\b|\bdebt\b|\bsimplify\b/.test(lower)) return "refactor";
  if (/\bnew\s+product\b|\bproduct\b/.test(lower)) return "new-product";
  if (/\bfeature\b|\benhancement\b|\bfeat\b|\bnew\b/.test(lower)) return "feature";
  return "investigate";
}

export function normalizeGithubLabels(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 10);
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean).slice(0, 10);
  }
  return [];
}

// Author allowlist parsing: empty means anyone (documented, never silent).
export function normalizeGithubAuthors(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 20);
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim().replace(/^@/, "")).filter(Boolean).slice(0, 20);
  }
  return [];
}

// Rule prompt threading: a per-rule instruction block appended to the
// curated issue prompt. Empty template leaves the prompt untouched.
export function applyRulePrompt(prompt, template) {
  const clean = typeof template === "string" ? template.trim().slice(0, 2_000) : "";
  if (!clean) return prompt;
  return `${prompt}\n\nRule instructions:\n${clean}`;
}

const RELATED_STOPWORDS = new Set([
  "the", "and", "with", "from", "into", "issue", "error", "fail", "fails",
  "failing", "when", "after", "before", "this", "that", "have", "does",
  "doesn", "don", "not", "for", "are", "was", "were", "been", "also",
]);

function titleTokens(title) {
  return String(title ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !RELATED_STOPWORDS.has(word));
}

// Possibly-related open issues by title word overlap: advisory triage
// signal, never a block. Excludes self, capped, deterministic order.
export function findRelatedIssues(issue, items, limit = 3) {
  const mine = new Set(titleTokens(issue?.title));
  if (mine.size === 0) return [];
  const selfKey = `${issue?.repo}#${issue?.number}`;
  const scored = [];
  for (const other of items ?? []) {
    if (!other || typeof other !== "object") continue;
    const key = `${other.repo}#${other.number}`;
    if (key === selfKey) continue;
    const theirs = titleTokens(other.title);
    let shared = 0;
    for (const word of theirs) if (mine.has(word)) shared += 1;
    if (shared >= 2) scored.push({ key, shared });
  }
  scored.sort((a, b) => b.shared - a.shared || (a.key < b.key ? -1 : 1));
  return scored.slice(0, limit).map((entry) => entry.key);
}

export { INTENT_ORDER };
