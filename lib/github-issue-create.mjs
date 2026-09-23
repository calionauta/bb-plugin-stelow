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

export function issueMarker(cardId) {
  return `<!-- ${STELOW_CARD_MARKER_PREFIX}${cardId} -->`;
}

export function issueKey(repo, number) {
  return `${repo}#${number}`;
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
    throw new Error("GitHub may have created the issue but the response was unreadable — check the repo (automatic linking is not retried, to avoid a double-create).");
  }
  return { number, url };
}
