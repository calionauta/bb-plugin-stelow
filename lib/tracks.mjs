/**
 * Card tracks: the single source of truth for the Build / Research / Explore
 * concepts. Every other module (server.ts RPC contract, card moves, board
 * grouping, UI tabs, inbox rendering) reads from here instead of repeating
 * the literals — renaming a track or adding a fourth one is one line.
 *
 * - build:    the orchestrated product workflow (triage → stages → gates).
 * - research: lightweight To-Do / Doing / Done investigations, one strategy
 *             round at a time, producing research-index.md + round files.
 * - explore:  lightweight To-Do / Doing / Done single-stage runs, producing
 *             one explore-<stage>.md artifact. No triage, no pipeline.
 *
 * NOTE: the word "delivery" never appears here on purpose. The old card kind
 * "delivery" was renamed to "build" (tracks v1); normalizeKind() keeps
 * reading legacy rows so existing databases migrate silently.
 */

export const CARD_KINDS = ["build", "research", "explore"];

/** Tracks with the lightweight To-Do / Doing / Done lifecycle (no stages). */
export const LIGHTWEIGHT_KINDS = ["research", "explore"];

/** Board columns for the lightweight lifecycle, shared by Research + Explore. */
export const LIGHTWEIGHT_COLUMNS = ["todo", "doing", "done", "archived"];

export const LIGHTWEIGHT_COLUMN_LABELS = {
  todo: "To-Do",
  doing: "Doing",
  done: "Done",
  archived: "Archived",
};

/** Which worker band each track spawns on (see lib/stage-bands.mjs). */
export const TRACK_BANDS = {
  build: "analysis",
  research: "research",
  explore: "explore",
};

export function isValidKind(kind) {
  return kind === "build" || kind === "research" || kind === "explore";
}

export function isLightweightKind(kind) {
  return kind === "research" || kind === "explore";
}

/**
 * Normalize a stored kind. Legacy "delivery" rows read as "build" so the
 * v0.3.x rename needs no destructive migration — the SQL UPDATE in server.ts
 * converges stored rows while this keeps every read path safe meanwhile.
 */
export function normalizeKind(kind) {
  if (kind === "delivery") return "build";
  return isValidKind(kind) ? kind : "build";
}

/** Worker entry band for a track (falls back to the build default). */
export function bandForKind(kind) {
  return TRACK_BANDS[normalizeKind(kind)] ?? "analysis";
}
