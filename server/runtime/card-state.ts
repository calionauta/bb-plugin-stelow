import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { clearClaimWaiters, waitersForFiles } from "../../lib/card-claims.mjs";
import { isClaimTerminal } from "../../lib/card-terminal.mjs";
import { assertCardStatus } from "../../lib/card-status.mjs";
import { HELD_ACTIVITY } from "../../lib/host-hold.mjs";
import { stripArchivedResuscitation } from "../../lib/worker-action-policy.mjs";
import type { WorkerCard } from "../workers-types.js";
import type { ActionRecorder } from "./action-log-runtime.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type CardFields = Partial<
  Omit<
    WorkerCard,
    "id" | "project_id" | "intent" | "prompt" | "name" | "created_at"
  >
>;

type InboxEventKind = "error" | "completed" | "paused" | "question";
type InboxActionKind = "error" | "paused" | "question";
type InboxResolutionReason = "archived" | "completed" | "resumed" | "superseded";

type CardUpdaterDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  recordInbox: (
    card: WorkerCard,
    kind: InboxEventKind,
    title: string,
    dedupeKey: string,
    createdAt: number,
  ) => unknown;
  // A failure need is identified by the card, not by the moment, so it has its
  // own recorder: it collapses a repeat onto the open row and reopens a
  // resolved one. Routing it through `recordInbox` is what let a repeat append a
  // second row every time.
  recordErrorInbox: (cardId: string, title: string, createdAt: number) => unknown;
  resolveInbox: (
    cardId: string,
    resolvedAt: number,
    kinds: InboxActionKind[],
    resolution: InboxResolutionReason,
  ) => unknown;
  // The terminal resolver: reaches `completed` too, for a card whose life has
  // ended. Kept separate from resolveInbox because the two answer different
  // questions — "is there anything left to do" versus "is this card over".
  resolveAllInbox: (
    cardId: string,
    resolvedAt: number,
    resolution: InboxResolutionReason,
  ) => unknown;
  /** The flight recorder. Optional in narrow tests; the runtime always passes
   * one, so a missing recorder means "no log", never "no card update". */
  actions?: ActionRecorder;
};

type UpdateOptions = { suppressCompletionEvent?: boolean; restoreFromArchive?: boolean };

export function createCardUpdater(deps: CardUpdaterDeps) {
  return function updateCard(
    cardId: string,
    fields: CardFields,
    options?: UpdateOptions,
  ): void {
    // Hot-reload race: bb closes the plugin DB while sync callbacks are still
    // in flight; writing then crashes the whole server process.
    if (!isDatabaseOpen(deps.db)) return;
    const previous = deps.getCard(cardId);
    // Archived is terminal: strip any status change that would resuscitate the
    // card (a stopping worker settling after Archive is the classic case).
    // Archiving itself always passes through, as does an explicit restore
    // through restoreCard (the only path that may carry restoreFromArchive).
    const effective = options?.restoreFromArchive
      ? (fields as Record<string, unknown>)
      : (stripArchivedResuscitation(
        previous?.status,
        fields as Record<string, unknown>,
      ) as Record<string, unknown>);
    const keys = Object.keys(effective);
    if (keys.length === 0) return;
    // No-op guard: sync polls call updateCard every cycle, usually with
    // identical values. Writing anyway would bump updated_at (reshuffling board
    // order and "Idle since" labels) and publish card-state for zero change.
    const changed = changedKeys(previous, keys, effective);
    if (previous && changed.length === 0) return;
    const finalWrite = finalCardWrite(deps, cardId, changed, effective, options);
    if (!Object.keys(finalWrite).some((key) => key !== "updated_at")) return;
    writeCard(deps.db, cardId, finalWrite);
    const current = deps.getCard(cardId);
    recordCardUpdate(deps, cardId, previous, current, changed, finalWrite);
    if (previous && current) reconcileTransitions(deps, cardId, previous, current, options);
    deps.bb.realtime.publish("card-state", { cardId });
  };
}

/**
 * One row per state change, with the before/after of the four fields that
 * answer "why does this card look like that?".
 *
 * The old design kept only `last_error`, so a loop that wrote 150 errors left
 * one slot reading "unknown error" while the cause was three writes earlier.
 * The row is not deduped: two unrelated updates carrying the same field name
 * are two facts, and collapsing them by a cause this call does not have would
 * hide the second. Text columns are measured, never copied — `last_assistant_text`
 * already lives on the card and in the thread, and a log that duplicates prose
 * is a second copy of the database.
 */
function recordCardUpdate(
  deps: CardUpdaterDeps,
  cardId: string,
  previous: WorkerCard | undefined,
  current: WorkerCard | undefined,
  changed: string[],
  write: Record<string, unknown>,
): void {
  if (!deps.actions) return;
  // Only fields that change the card's state are worth a row. Every turn
  // rewrites `last_assistant_text` (and `updated_at`), and logging those made
  // one `card.updated` row per model message whose only content was "the prose
  // changed" — the prose the recorder is forbidden to keep.
  const meaningful = changed.filter((key) => MEANINGFUL_CARD_FIELDS.has(key));
  if (meaningful.length === 0) return;
  const before = previous as unknown as Record<string, unknown> | undefined;
  const after = current as unknown as Record<string, unknown> | undefined;
  const detail: Record<string, unknown> = { fields: meaningful };
  for (const key of ["status", "stage", "activity"]) {
    if (!meaningful.includes(key)) continue;
    detail[key] = { from: before?.[key] ?? null, to: after?.[key] ?? write[key] ?? null };
  }
  if (meaningful.includes("last_error")) {
    detail.lastError = truncateText(after?.last_error ?? write.last_error);
  }
  if (meaningful.includes("accepted_at") && after?.accepted_at != null) {
    detail.acceptedAt = after.accepted_at;
  }
  deps.actions.record({
    kind: "card.updated",
    outcome: "ok",
    cardId,
    stage: typeof after?.stage === "string" ? after.stage : null,
    detail,
  });
}

function truncateText(value: unknown, limit = 300): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function isDatabaseOpen(db: Db): boolean {
  return Boolean((db as unknown as { open?: boolean }).open);
}

function changedKeys(
  previous: WorkerCard | undefined,
  keys: string[],
  effective: Record<string, unknown>,
): string[] {
  if (!previous) return keys;
  const before = previous as unknown as Record<string, unknown>;
  return keys.filter((key) => before[key] !== effective[key]);
}

// The written values come from the same snapshot the changed keys were derived
// from; only the terminal re-check reads again. Deriving keys from the first
// read and values from the second would let a card archived during an awaited
// call re-enter the write as a stripped status key holding undefined, which is
// exactly the resurrection this re-check exists to prevent.
function finalCardWrite(
  deps: CardUpdaterDeps,
  cardId: string,
  changed: string[],
  effective: Record<string, unknown>,
  options?: UpdateOptions,
): Record<string, unknown> {
  const write: Record<string, unknown> = { updated_at: deps.now() };
  for (const key of changed) write[key] = effective[key];
  if (options?.restoreFromArchive) return write;
  return stripArchivedResuscitation(
    deps.getCard(cardId)?.status,
    write,
  ) as Record<string, unknown>;
}

function writeCard(db: Db, cardId: string, fields: Record<string, unknown>): void {
  // The single choke point every card update passes through. Validating here
  // rather than in the schema is a deliberate trade, argued at length in
  // lib/card-status.mjs: SQLite cannot add a CHECK to an existing table, and
  // rebuilding `cards` under live threads costs more than it buys when this one
  // function sees every write the app makes.
  assertCardStatus(fields.status, `card update for ${cardId}`);
  const assignments = Object.keys(fields)
    .map((key) => `${key} = @${key}`)
    .join(", ");
  db.prepare(`UPDATE cards SET ${assignments} WHERE id = @id`)
    .run({ id: cardId, ...fields });
}

function reconcileTransitions(
  deps: CardUpdaterDeps,
  cardId: string,
  previous: WorkerCard,
  current: WorkerCard,
  options?: UpdateOptions,
): void {
  resolveAttentionEvents(deps, cardId, current);
  recordNewCompletion(deps, cardId, previous, current, options);
  recordNewFailure(deps, cardId, previous, current);
}

function resolveAttentionEvents(
  deps: CardUpdaterDeps,
  cardId: string,
  current: WorkerCard,
): void {
  // Archiving is terminal, so it closes EVERY open row — including `completed`.
  // An archived card is off the board and its worker is stopped: an open review
  // request for it is a notification demanding an action nobody can take, and it
  // would hold the inbox badge above zero forever. The rows survive in Resolved
  // history reading "Closed with the card", which is the honest account of a
  // card that was archived before anyone reviewed it.
  if (current.status === "archived") {
    deps.resolveAllInbox(cardId, current.updated_at, "archived");
    return;
  }
  // Completion is NOT terminal in the same way: the review it asks for is the
  // whole point of an unread `completed` row, so only the actionable kinds are
  // closed here. `hasPendingReview` is what decides the card still wants eyes.
  if (current.status === "completed") {
    deps.resolveInbox(cardId, current.updated_at, ["question", "error", "paused"], "completed");
    return;
  }
  // A card that is moving again closes its own open rows, whether the host is
  // the one moving it or a person is. `held` is in this list because a hold is
  // the host taking the card back: the queued message is on its way, so a
  // `paused` row left open beside it is a notification about a problem the
  // host is already solving.
  if (current.activity === "running" || current.activity === HELD_ACTIVITY) {
    deps.resolveInbox(cardId, current.updated_at, ["error", "paused"], "resumed");
  }
}

function recordNewCompletion(
  deps: CardUpdaterDeps,
  cardId: string,
  previous: WorkerCard,
  current: WorkerCard,
  options?: UpdateOptions,
): void {
  if (previous.status === "completed" || current.status !== "completed") return;
  if (current.kind !== "build" || options?.suppressCompletionEvent) return;
  deps.recordInbox(
    current,
    "completed",
    "Build complete — audit evidence is ready to review in Done.",
    `completed:${cardId}:${current.updated_at}`,
    current.updated_at,
  );
}

function recordNewFailure(
  deps: CardUpdaterDeps,
  cardId: string,
  previous: WorkerCard,
  current: WorkerCard,
): void {
  if (previous.activity === "error" || current.activity !== "error") return;
  deps.recordErrorInbox(
    cardId,
    current.last_error || "Worker failed and needs attention.",
    current.updated_at,
  );
  const openQuestion = deps.db
    .prepare(
      "SELECT 1 FROM inbox_events WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL AND archived_at IS NULL LIMIT 1",
    )
    .get(cardId);
  if (openQuestion) {
    deps.resolveInbox(cardId, current.updated_at, ["error"], "superseded");
  }
}

/** The card fields a state change is made of. Everything else a write touches
 * (`last_assistant_text`, `updated_at`, a derived timestamp) is bookkeeping the
 * log must not turn into one row per model turn. */
const MEANINGFUL_CARD_FIELDS = new Set([
  "status",
  "stage",
  "activity",
  "last_error",
  "accepted_at",
  "worker_preset_id",
  "preset_restart_pending",
  "worker_thread_id",
  "kind",
  "dir_hash",
  "workspace_path",
  "read_miss_since",
]);

type ClaimWaiterDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  resolveInbox: CardUpdaterDeps["resolveInbox"];
  findWaiters?: typeof waitersForFiles;
  clearWaiters?: typeof clearClaimWaiters;
};

export function createClaimWaiterNotifier(deps: ClaimWaiterDeps) {
  return async function notifyClaimWaiters(
    workspacePath: string,
    files: string[],
  ): Promise<void> {
    if (files.length === 0 || !workspacePath) return;
    // One timestamp for the whole sweep. Waiters freed by a single release are
    // one event, so their resolved inbox rows must share a timestamp; a
    // per-waiter clock read would order them by scheduling jitter and split
    // the sweep into several.
    const resumedAt = deps.now();
    const waiters = claimWaiters(deps, workspacePath, files);
    const seen = new Set<string>();
    for (const waiter of waiters) {
      if (seen.has(waiter.card_id)) continue;
      seen.add(waiter.card_id);
      await resumeWaiter(deps, workspacePath, files, waiter.card_id, resumedAt);
    }
  };
}

function claimWaiters(
  deps: ClaimWaiterDeps,
  workspacePath: string,
  files: string[],
): Array<{ card_id: string; scope: string | null }> {
  try {
    return (deps.findWaiters ?? waitersForFiles)(
      deps.db,
      { workspacePath, files },
    );
  } catch {
    return [];
  }
}

async function resumeWaiter(
  deps: ClaimWaiterDeps,
  workspacePath: string,
  files: string[],
  cardId: string,
  resumedAt: number,
): Promise<void> {
  const card = deps.getCard(cardId);
  if (!card || isClaimTerminal(card.status)) {
    clearWaiters(deps, cardId);
    return;
  }
  deps.resolveInbox(cardId, resumedAt, ["paused"], "resumed");
  clearWaiters(deps, cardId, workspacePath, files);
  if (card.worker_thread_id) await nudgeWaiter(deps.bb, card.worker_thread_id, files);
  deps.bb.realtime.publish("card-state", { cardId });
}

function clearWaiters(
  deps: ClaimWaiterDeps,
  cardId: string,
  workspacePath?: string,
  files?: string[],
): void {
  try {
    (deps.clearWaiters ?? clearClaimWaiters)(
      deps.db,
      { cardId, workspacePath, files },
    );
  } catch {
    /* advisory */
  }
}

async function nudgeWaiter(
  bb: BbPluginApi,
  threadId: string,
  files: string[],
): Promise<void> {
  const text = `Files you waited on are now free (${files.join(", ")}). Re-run \`bb stelow lock acquire --scope <id>\` for the files you \
still need, then continue the scope — do not re-claim files you no longer touch.`;
  try {
    await bb.sdk.threads.send({
      threadId,
      mode: "auto",
      input: [{ type: "text", text, mentions: [], visibility: "agent-only" }],
    });
  } catch {
    /* a dead thread stays parked; the user resumes by hand */
  }
}
