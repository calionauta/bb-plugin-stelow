/**
 * Research round files and history. Each strategy round persists its native
 * playbook output verbatim under `rounds/` (one file per round, one per
 * sub-step when a playbook fans out, e.g. JTBD's 10 prompts) while brief.md
 * stays the machine-read aggregator for fan-out. History entries carry a
 * timestamp so rounds list newest-first; legacy plain-id arrays degrade to
 * `{ id, at: null }`.
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
 * Workspace-relative path for a round file, e.g.
 * `rounds/pricing-r2-20260905-1830.md` or
 * `rounds/job-to-be-done-job-map-steps-r1-20260905-1835.md`.
 */
export function roundFilePath(strategyId, roundNo, stamp, subskill = null) {
  const sub = subskill ? `-${slugify(subskill)}` : "";
  return `${ROUNDS_DIR}/${strategyId}${sub}-r${roundNo}-${stamp}.md`;
}

/**
 * Normalize stored history (research_strategies column, or the legacy
 * single id) to [{ id, at }]. Accepts legacy ["a"], new [{id, at}],
 * mixed arrays, and garbage — anything unparseable degrades to [].
 */
export function normalizeHistory(raw, fallbackId = null) {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return typeof fallbackId === "string" && fallbackId.length > 0 ? [{ id: fallbackId, at: null }] : [];
    }
  }
  if (!Array.isArray(parsed)) {
    return typeof fallbackId === "string" && fallbackId.length > 0 ? [{ id: fallbackId, at: null }] : [];
  }
  const out = [];
  for (const entry of parsed) {
    if (typeof entry === "string" && entry.length > 0) out.push({ id: entry, at: null });
    else if (entry && typeof entry === "object" && typeof entry.id === "string" && entry.id.length > 0) {
      out.push({ id: entry.id, at: typeof entry.at === "string" && entry.at.length > 0 ? entry.at : null });
    }
  }
  if (out.length === 0 && typeof fallbackId === "string" && fallbackId.length > 0) return [{ id: fallbackId, at: null }];
  return out;
}

/**
 * True when a workspace-relative path is a round file for the given
 * strategy id and 1-based round number, e.g.
 * `rounds/pricing-r2-20260905-1830.md` or
 * `rounds/job-to-be-done-job-map-steps-r1-20260905-1835.md`.
 */
export function matchRoundFile(relPath, strategyId, roundNo) {
  if (typeof relPath !== "string" || typeof strategyId !== "string") return false;
  const base = relPath.split("/").pop() ?? "";
  if (!relPath.startsWith(`${ROUNDS_DIR}/`) || !base.endsWith(".md")) return false;
  if (!base.startsWith(`${strategyId}-`)) return false;
  const rest = base.slice(strategyId.length + 1, -".md".length);
  return new RegExp(`(?:^|-)r${roundNo}-\\d{8}-\\d{4}$`).test(rest);
}

/**
 * Join timestamped history with resolved manifest files into the rounds
 * view, newest first. Pure (no I/O): `files` are pre-resolved
 * [{ path, display, absolutePath, hostId, generatedAt }]. Duplicate paths
 * collapse. A round without files is pending while its worker is alive
 * (`live`), otherwise missing.
 */
export function buildRoundsView(history, files, live) {
  const rounds = history.map((round, index) => {
    const seen = new Set();
    const matched = [];
    for (const file of files) {
      if (!matchRoundFile(file.path, round.id, index + 1)) continue;
      if (seen.has(file.absolutePath)) continue;
      seen.add(file.absolutePath);
      matched.push({ ...file, generatedAt: file.generatedAt || round.at || "" });
    }
    matched.sort((a, b) => (a.display < b.display ? -1 : 1));
    const status = matched.length > 0 ? "ready" : (index + 1 === history.length && live ? "pending" : "missing");
    return { n: index + 1, strategyId: round.id, at: round.at, status, files: matched };
  });
  return rounds.reverse();
}
