/**
 * Which `cards` columns deserve an action-log row, and why the rest do not.
 *
 * `card.updated` used to record every changed column, then a fix filtered it
 * to a hand-written allowlist. The allowlist is the danger: a column added
 * later is silently ignored, and "the log says nothing" reads as "it did not
 * happen". So every column is classified here — logged, or ignored with the
 * reason — and a test reads the REAL migrated schema and fails when a column is
 * in neither list.
 *
 * The split is not "important vs unimportant". A logged field changes what the
 * card IS (status, stage, preset, workspace, lineage, accepted). An ignored
 * field is either immutable, a clock, derived from something already logged,
 * or prose the recorder is forbidden to keep.
 */
export const CARD_LOG_FIELDS = new Set([
  "status",
  "stage",
  "activity",
  "worker_thread_id",
  "worker_preset_id",
  "preset_restart_pending",
  "last_error",
  "kind",
  "dir_hash",
  "workspace_kind",
  "workspace_path",
  "workspace_host_id",
  "research_strategy",
  "research_strategies",
  "explore_stage",
  "split_from",
  "accepted_at",
  "read_miss_since",
  "attachments",
  "spawn_retry_count",
  "spawn_retry_thread",
]);

/** Column → why no row. Every ignored column needs a reason, not a shrug. */
export const CARD_LOG_IGNORED = Object.freeze({
  id: "immutable identity",
  project_id: "immutable identity",
  name: "immutable at creation",
  prompt: "prompt body; the recorder never keeps prose",
  intent: "immutable at creation",
  created_at: "immutable clock",
  updated_at: "write clock, changes on every row",
  last_assistant_text: "agent prose; the card and thread keep it",
  last_idle_text: "agent prose; the card and thread keep it",
  last_idle_at: "derived idle clock",
  display_name: "auto-naming churn",
  environment_label: "derived from the environment",
  auto_continue_count: "auto-continue budget counter",
  auto_continue_stage: "auto-continue budget counter",
});

export function isLoggedCardField(key) {
  return typeof key === "string" && CARD_LOG_FIELDS.has(key);
}

/** Columns in `columns` that appear in neither list. Empty is the invariant. */
export function unclassifiedCardFields(columns) {
  if (!Array.isArray(columns)) return [];
  return columns.filter(
    (column) => !CARD_LOG_FIELDS.has(column) && !Object.hasOwn(CARD_LOG_IGNORED, column),
  );
}
