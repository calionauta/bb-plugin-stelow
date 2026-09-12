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
 * A stored kind this module does not recognize reads as "build" — every read
 * path goes through normalizeKind(), so it is the only place that can answer
 * the question. Nothing else in the codebase repeats the literals.
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

/** Which worker band each track spawns on (see lib/workflow-vocabulary.mjs). */
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

/** The one place a stored kind becomes a track: an unrecognized value is a build. */
export function normalizeKind(kind) {
  return isValidKind(kind) ? kind : "build";
}

/** Worker entry band for a track (falls back to the build default). */
export function bandForKind(kind) {
  return TRACK_BANDS[normalizeKind(kind)] ?? "analysis";
}
