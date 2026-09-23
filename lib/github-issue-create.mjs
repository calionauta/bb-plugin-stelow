/**
 * GitHub issue creation at card birth, via the gh CLI.
 *
 * Taskboard's proven pattern, ported: reads go through the github plugin's
 * RPCs, but creation shells to `gh` (same auth as `gh auth login`, no second
 * token). Pure builders here so the shape is unit-tested; the plugin server
 * owns spawning. Follows taskboard's honesty rule: an unconfirmed write is
 * reported uncertain, never retried blindly — a retry could double-create.
 */

// Candidates mirror taskboard's resolution order: PATH first, then the
// common Homebrew locations.
export const GH_CANDIDATES = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];

export async function resolveGhPath(probe) {
  for (const candidate of GH_CANDIDATES) {
    try {
      if (await probe(candidate)) return candidate;
    } catch { /* try the next location */ }
  }
  throw new Error("GitHub CLI (gh) is not available on the host.");
}

export const STELOW_CARD_MARKER_PREFIX = "stelow-card:";

// Machine-detectable uncertain outcome (taskboard's convention): a client
// can branch on this marker instead of parsing prose. The message stays
// human-readable around it.
export const CREATE_OUTCOME_UNCERTAIN_MARKER = "[STELOW_CREATE_OUTCOME_UNCERTAIN]";

export function issueMarker(cardId) {
  return `<!-- ${STELOW_CARD_MARKER_PREFIX}${cardId} -->`;
}

export function issueKey(repo, number) {
  return `${repo}#${number}`;
}

// Shared repo selection (creation dialog and linked-discussion CTA use one
// rule): an explicit pick must be mapped, silence needs exactly one mapped
// repo, anything else refuses with the redirect instead of guessing.
export function resolveTargetRepo({ mapped, requested }) {
  const repos = [...new Set((Array.isArray(mapped) ? mapped : []).filter((repo) => typeof repo === "string" && repo.includes("/")))];
  if (requested) {
    if (!repos.includes(requested)) return { ok: false, repo: null, error: `Repository ${requested} is not mapped to this project.` };
    return { ok: true, repo: requested, error: null };
  }
  if (repos.length === 0) return { ok: false, repo: null, error: "No GitHub repository is mapped to this project." };
  if (repos.length > 1) return { ok: false, repo: null, error: "Several repositories are mapped to this project — pick one." };
  return { ok: true, repo: repos[0], error: null };
}

// Human-authored issue comments: non-empty, within the API limit. Workers
// never reach this (UI-gated like every other write-back), but the server
// enforces it anyway — trust the gesture, verify the payload.
export const POST_BODY_MAX_CHARS = 60000;

export function validatePostBody(body) {
  const text = String(body ?? "").trim();
  if (!text) return { ok: false, text: "", error: "Comment must not be empty." };
  if (text.length > POST_BODY_MAX_CHARS) return { ok: false, text: "", error: `Comment exceeds ${POST_BODY_MAX_CHARS} characters.` };
  return { ok: true, text, error: null };
}

// Brief for the done-note draft burst: the model gets facts, never a license
// to invent. Artifacts ride separately as a checklist the human detaches.
export function buildDoneCommentBrief({ title, intent, stage, scopesDone, scopesTotal, scopeLines, promptExcerpt }) {
  return [
    "Write a short human-readable completion note for a GitHub issue comment (5-10 lines, plain Markdown, no emojis, no hype).",
    `Card: ${title} (intent: ${intent}, stage: ${stage}).`,
    `Scopes: ${scopesDone}/${scopesTotal} done.`,
    ...scopeLines,
    `What was asked: ${promptExcerpt}`,
    "Rules: state only what the context above supports; never invent results, numbers, or file names; no closing call-to-action.",
  ].join("\n");
}

export function buildCreateIssueArgs({ repo, title, body }) {
  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) throw new Error("GitHub issue title must not be empty.");
  if (!repo || !repo.includes("/")) throw new Error("GitHub repo must look like owner/name.");
  return ["api", "--method", "POST", `repos/${repo}/issues`, "--raw-field", `title=${cleanTitle}`, "--raw-field", `body=${body ?? ""}`];
}

export function issueBodyForCard({ prompt, cardId }) {
  return `${String(prompt ?? "").trim()}\n\n${issueMarker(cardId)}`;
}

export function parseCreateIssueResponse(raw) {
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const number = parsed && typeof parsed.number === "number" && Number.isSafeInteger(parsed.number) && parsed.number > 0 ? parsed.number : null;
  const url = parsed && typeof parsed.html_url === "string" && parsed.html_url ? parsed.html_url : null;
  if (number === null || url === null) {
    throw new Error(`${CREATE_OUTCOME_UNCERTAIN_MARKER} GitHub may have created the issue but the response was unreadable — check the repo (automatic linking is not retried, to avoid a double-create).`);
  }
  return { number, url };
}
