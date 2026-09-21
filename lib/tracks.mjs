/**
 * Card tracks: the single source of truth for the Build / Research / Explore
 * concepts. Every other module (server.ts RPC contract, card moves, board
 * grouping, UI tabs, inbox rendering) reads from here instead of repeating
 * the literals — renaming a track or adding a fourth one is one line.
 *
 * - build:    the orchestrated product workflow (triage → stages → gates).
 * - research: lightweight Bucket / Doing / Done investigations, one strategy
 *             round at a time, producing research-index.md + round files.
 * - explore:  lightweight Bucket / Doing / Done single-stage runs, producing
 *             one explore-<stage>.md artifact. No triage, no pipeline.
 *
 * A stored kind this module does not recognize reads as "build" — every read
 * path goes through normalizeKind(), so it is the only place that can answer
 * the question. Nothing else in the codebase repeats the literals.
 */

import { BUILD_BOARD_COLUMNS, BUILD_BOARD_INBOX } from "./workflow-vocabulary.mjs";

export const CARD_KINDS = ["build", "research", "explore"];

/** Tracks with the lightweight Bucket / Doing / Done lifecycle (no stages). */
export const LIGHTWEIGHT_KINDS = ["research", "explore"];

/**
 * Board columns for the lightweight lifecycle, shared by Research + Explore.
 *
 * The first column is the Bucket — the one word for "captured, nothing running
 * yet" on every track (Build's board reads the same name). It replaced an
 * "Inbox" that collided with the notification center, which itself replaced
 * a "To-Do" that described work the user had already decided to do.
 */
export const LIGHTWEIGHT_COLUMNS = ["inbox", "doing", "done", "archived"];
// Same render rule as the Build board: the Bucket lives in the header
// button + gallery, never as a rendered column.
export const LIGHTWEIGHT_VISIBLE_COLUMNS = LIGHTWEIGHT_COLUMNS.filter((column) => column !== BUILD_BOARD_INBOX);

export const LIGHTWEIGHT_COLUMN_LABELS = {
  inbox: "Bucket",
  doing: "Doing",
  done: "Done",
  archived: "Archived",
};

/** Stored-card status for each lightweight board column. */
export const LIGHTWEIGHT_STATUS_BY_COLUMN = {
  inbox: "pending",
  doing: "in-progress",
  done: "completed",
  archived: "archived",
};

/** Every allowed manual board-move target, derived from both board models. */
export const BOARD_MOVE_COLUMNS = [...BUILD_BOARD_COLUMNS, ...LIGHTWEIGHT_COLUMNS.filter((column) => !BUILD_BOARD_COLUMNS.includes(column))];

/** Lightweight board projection for a stored card status. */
export function lightweightColumnForStatus(status) {
  if (status === "archived") return "archived";
  if (status === "completed") return "done";
  if (status === "in-progress" || status === "approved") return "doing";
  return "inbox";
}

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

/**
 * Where a card's worker runs, as one stored word. Decided once at creation
 * from the resolved spawn environment — the open card reads it instead of
 * guessing from paths, so "shared or worktree?" is always answerable.
 */
export function describeCardEnvironment({ exploratory, envType, workspaceType }) {
  if (exploratory) return "exploratory";
  if (envType === "project-default") return "managed";
  if (workspaceType === "managed-worktree") return "worktree";
  if (workspaceType === "personal") return "personal";
  if (workspaceType === "unmanaged") return "shared";
  return "unknown";
}
