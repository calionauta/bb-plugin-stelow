/**
 * Research round files and history. Each strategy round persists its native
 * playbook output verbatim under `rounds/` (one file per round, one per
 * sub-step when a playbook fans out, e.g. JTBD's 10 prompts) while research-index.md
 * stays the machine-read aggregator for fan-out. History entries carry id,
 * timestamp, and file path — the server computes all three at spawn, so
 * listing never guesses. History has exactly one shape:
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
 * Substep file paths belonging to one primary round file. Joins history
 * (the deterministic primary path) with manifest paths (worker-registered
 * extras) on strategy + roundNo + stamp via parseRoundPath; only entries
 * with a non-null subskill join, so the primary itself never matches.
 * Pure — tested, no I/O. Returns paths in manifest order, deduplicated.
 */
export function substepPathsForRound(manifestPaths, strategyId, primaryFile) {
  const primary = parseRoundPath(primaryFile, strategyId);
  if (!primary) return [];
  const seen = new Set();
  const out = [];
  for (const candidate of Array.isArray(manifestPaths) ? manifestPaths : []) {
    if (typeof candidate !== "string" || !candidate || candidate === primaryFile) continue;
    const parsed = parseRoundPath(candidate, strategyId);
    if (!parsed || parsed.subskill == null) continue;
    if (parsed.roundNo !== primary.roundNo || parsed.stamp !== primary.stamp) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

/**
 * Declared substeps that exist on disk but were never registered.
 *
 * The depth gate used to be driven entirely by the worker's own manifest, which
 * made registration a licence: a worker could write every declared substep as a
 * stub, register only the umbrella round file, and have the round read as ready.
 * That is not hypothetical — a real card's index says it outright, in the
 * present tense: the per-step files are "deliberately NOT registered in
 * `state.md`, so they do not gate `verify`/`done`". It was accurate about the
 * code, and wrong about the method: the skill defines a simulated hypothesis as
 * a first-class output ("a plausible invented example used to make a candidate
 * concrete"), so thin substeps are under-delivery, not a legitimate opt-out.
 *
 * So registration is no longer the gate. A declared substep that is PRESENT on
 * disk is gated whether or not the worker registered it. A declared substep that
 * was never written is not reported here — nothing to gate, and a legitimately
 * partial run must still be able to finish.
 *
 * `presentPaths` is the round directory listing; `registeredPaths` what the
 * manifest declared. Pure — no I/O.
 *
 * @param {string[]} declaredSlugs the strategy's declared substeps
 * @param {string[]} registeredPaths paths the worker registered
 * @param {string[]} presentPaths paths that exist on disk
 * @param {string} strategyId
 * @param {string} primaryFile the round's deterministic primary path
 * @returns {string[]} paths to gate, in `presentPaths` order
 */
export function unregisteredSubstepPaths(declaredSlugs, registeredPaths, presentPaths, strategyId, primaryFile) {
  const registered = new Set(Array.isArray(registeredPaths) ? registeredPaths : []);
  const declared = new Set(Array.isArray(declaredSlugs) ? declaredSlugs : []);
  const out = [];
  for (const path of Array.isArray(presentPaths) ? presentPaths : []) {
    if (typeof path !== "string" || !path || registered.has(path) || path === primaryFile) continue;
    const parsed = parseRoundPath(path, strategyId);
    if (!parsed || parsed.subskill == null || !declared.has(parsed.subskill)) continue;
    if (!parsed || parseRoundPath(primaryFile, strategyId)?.stamp !== parsed.stamp) continue;
    out.push(path);
  }
  return out;
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
