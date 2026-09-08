/**
 * Research round files and history. Each strategy round persists its native
 * playbook output verbatim under `rounds/` (one file per round, one per
 * sub-step when a playbook fans out, e.g. JTBD's 10 prompts) while research-index.md
 * stays the machine-read aggregator for fan-out. History entries carry id,
 * timestamp, and file path — the server computes all three at spawn, so
 * listing never guesses. No legacy formats: history is always
 * [{id, at, file}].
 */

export const ROUNDS_DIR = "rounds";

/** Filesystem-safe slug for sub-step names (strategy ids already are slugs). */
export function slugify(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** Compact UTC stamp for filenames: YYYYMMDD-HHMM. */
export function roundTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

/**
 * Basename for a round file, e.g. `pricing-r2-20260905-1830.md` or
 * `job-to-be-done-job-map-steps-r1-20260905-1835.md`. Round files live in
 * a rounds/ dir inside the workflow state dir (next to research-index.md); the
 * server composes the workspace-relative path, workers never invent
 * directories.
 */
export function roundFileName(strategyId, roundNo, stamp, subskill = null) {
  const sub = subskill ? `-${slugify(subskill)}` : "";
  return `${strategyId}${sub}-r${roundNo}-${stamp}.md`;
}

/**
 * Parse a round filename for a known strategy id:
 * `{ subskill, roundNo, stamp }`, or null when the shape doesn't match.
 * Matches on the basename, so state-dir nesting is irrelevant.
 */
export function parseRoundPath(relPath, strategyId) {
  if (typeof relPath !== "string" || typeof strategyId !== "string") return null;
  const base = relPath.split("/").pop() ?? "";
  if (!base.endsWith(".md")) return null;
  if (!base.startsWith(`${strategyId}-`)) return null;
  const rest = base.slice(strategyId.length + 1, -".md".length);
  const match = rest.match(/^(?:(.+)-)?r(\d+)-(\d{8}-\d{4})$/);
  if (!match) return null;
  return { subskill: match[1] ?? null, roundNo: Number(match[2]), stamp: match[3] };
}

/**
 * Normalize stored history (research_strategies column) to
 * [{ id, at, file }]. Strict: id and at are required; file defaults to ""
 * (a round whose file path is unknown renders as missing, never vanishes).
 * Anything else degrades to [].
 */
export function normalizeHistory(raw) {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const entry of parsed) {
    if (
      entry && typeof entry === "object" &&
      typeof entry.id === "string" && entry.id.length > 0 &&
      typeof entry.at === "string" && entry.at.length > 0
    ) {
      out.push({ id: entry.id, at: entry.at, file: typeof entry.file === "string" ? entry.file : "" });
    }
  }
  return out;
}
