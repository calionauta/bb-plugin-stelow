import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { acceptanceRefusal, acceptedDate } from "../../lib/card-acceptance.mjs";
import { heuristicDisplayName } from "../../lib/draft-burst.mjs";
import { needsNaming } from "../../lib/card-naming.mjs";
import { statusForNewCardWork } from "../../lib/card-work-resume.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import { commentDeliveryLine, answerFeedbackHolds } from "../../lib/answer-feedback.mjs";
import { holdUpdates } from "../../lib/host-hold.mjs";
import { openExpiredCount } from "./answer-feedback.js";
import { sendWorkerInput } from "./thread-send.js";
import { canEditWorkflowIntent } from "../../lib/workflow-intent-policy.mjs";
import { OWNERSHIP_UNVERIFIED } from "../../lib/ownership-refusal.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Workspace = { path: string; hostId: string | null };
const ERR_CARD_ARCHIVED = "This card is archived.";

type CardMutationDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  workflowStateDir: (
    bb: BbPluginApi,
    rootPath: string,
    workflowId: string,
    dirHash: string,
  ) => Promise<string | null>;
  logCardComment: (
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ) => string;
  /** Close the card's open review request. Accepting a finished result is the
   * act the completion row was asking for, so the row stops asking. */
  markReviewSatisfied: (cardId: string) => Promise<{ marked: boolean }>;
  updateCard: (cardId: string, values: Record<string, unknown>) => void;
  errors: { cardNotFound: string; cardArchived: string };
};

async function syncIntentState(
  deps: CardMutationDeps,
  card: WorkerCard,
  intent: string,
): Promise<string | null> {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return null;
  const stateDir = card.dir_hash
    ? await deps.workflowStateDir(
        deps.bb,
        workspace.path,
        card.id,
        card.dir_hash,
      )
    : null;
  if (card.dir_hash && !stateDir) {
    return `${OWNERSHIP_UNVERIFIED} Reseed this card before changing its workflow type.`;
  }
  const statePath = stateDir
    ? join(stateDir, "state.md")
    : join(workspace.path, "state.md");
  const existing = await deps.bb.sdk.files
    .read({ path: statePath })
    .catch(() => null);
  if (existing) {
    await deps.bb.sdk.files.write({
      path: statePath,
      content: existing.content.replace(/^intent:.*$/m, `intent: ${intent}`),
    });
  }
  return null;
}

export function createCardMutationHandlers(deps: CardMutationDeps) {
  return {
    updateCardIntent: (input: { cardId: string; intent: string }) =>
      updateCardIntent(deps, input),
    renameCard: (input: { cardId: string; name: string }) =>
      renameCard(deps, input),
    updateCardPrompt: (input: { cardId: string; prompt: string }) =>
      updateCardPrompt(deps, input),
    updateCardWorkspace: (input: { cardId: string; projectId: string }) =>
      updateCardWorkspace(deps, input),
    addCardComment: (input: {
      cardId: string;
      target: "card" | "scope" | "task";
      targetId: string;
      body: string;
    }) => addCardComment(deps, input),
    acceptCard: (input: { cardId: string }) => acceptCard(deps, input),
  };
}

async function updateCardIntent(
  deps: CardMutationDeps,
  { cardId, intent }: { cardId: string; intent: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  if (!canEditWorkflowIntent(card)) {
    return {
      ok: false,
      error: card.kind !== "build"
        ? "Only Build cards use a workflow type."
        : "This workflow has already left triage. Reclassify it from Card actions to restart from triage.",
    };
  }
  deps.db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?")
    .run(intent, deps.now(), cardId);
  try {
    const error = await syncIntentState(deps, card, intent);
    if (error) return { ok: false, error };
  } catch {
    /* state.md sync is best-effort */
  }
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

/**
 * Record that a person accepted this card's finished result.
 *
 * A receipt, never a gate: it is written only when a person writes it, it never
 * blocks the workflow, and it creates no wait. What it changes is the audit
 * trail — a Done card a human looked at and accepted stops reading identically
 * to one nobody has opened.
 *
 * The trail comment is the openable record. Acceptance does not route to the
 * worker: the card is Done, its worker has finished, and waking it would turn a
 * disposition into new work.
 */
async function acceptCard(deps: CardMutationDeps, { cardId }: { cardId: string }) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound, acceptedAt: null };
  const refusal = acceptanceRefusal({ status: card.status });
  if (refusal) return { ok: false, error: refusal, acceptedAt: null };
  const at = deps.now();
  deps.db.prepare("UPDATE cards SET accepted_at = ?, updated_at = ? WHERE id = ?")
    .run(at, at, cardId);
  deps.logCardComment(
    cardId,
    "card",
    cardId,
    "user",
    `Accepted the finished result on ${acceptedDate(at)}. Done certifies the verification; this records a human disposition of it.`,
  );
  // A person who has just accepted the result is not owed the review request
  // again. Best-effort: the receipt is the record, and a failed close must not
  // undo it.
  try {
    await deps.markReviewSatisfied(cardId);
  } catch {
    /* the acceptance itself is what was asked for */
  }
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null, acceptedAt: at };
}

async function renameCard(
  deps: CardMutationDeps,
  { cardId, name }: { cardId: string; name: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  const next = name.trim().slice(0, 120) ||
    heuristicDisplayName(card.prompt, card.name);
  deps.db.prepare("UPDATE cards SET display_name = ?, updated_at = ? WHERE id = ?")
    .run(next, deps.now(), cardId);
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

export const ERR_PROMPT_EMPTY = "The description is empty.";
export const ERR_PROMPT_TOO_LONG = "The description is over 20,000 characters.";
const ERR_CARD_STARTED = "This card already started — its description is locked.";
const ERR_CARD_COMPLETED = "This card is completed — its description is locked.";

const PARKED_STATUSES = new Set(["draft", "pending"]);

/**
 * Which refusal a prompt edit earns, if any. Parked means worker-less AND
 * in a pre-start status: a completed row with a cleaned-up worker is still
 * refused, and a row the worker already consumed is refused even when the
 * thread handle is momentarily absent.
 */
function promptEditRefusal(card: WorkerCard): string | null {
  if (isArchivedCard(card)) return ERR_CARD_ARCHIVED;
  if (card.status === "completed") return ERR_CARD_COMPLETED;
  if (card.worker_thread_id) return ERR_CARD_STARTED;
  if (!PARKED_STATUSES.has(card.status)) return ERR_CARD_STARTED;
  return null;
}

/**
 * Edit a parked card's description. Allowed only before Start: the worker
 * prompt is built from `cards.prompt` at spawn, so a parked edit is what
 * the worker receives, while a post-start edit would fork live work.
 *
 * The gate is re-checked immediately before the write: a Start landing
 * mid-edit is refused, never half-applied, and the draft stays with the
 * caller (refusals carry no write). Synchronous DB write — no timeout,
 * no retry, no trail comment.
 */
async function updateCardPrompt(
  deps: CardMutationDeps,
  { cardId, prompt }: { cardId: string; prompt: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  const gate = promptEditRefusal(card);
  if (gate) return { ok: false, error: gate };
  const next = typeof prompt === "string" ? prompt.trim() : "";
  if (next.length === 0) return { ok: false, error: ERR_PROMPT_EMPTY };
  if (next.length > 20_000) return { ok: false, error: ERR_PROMPT_TOO_LONG };
  // Re-read before writing: a Start may have landed between the gate check
  // and this line, and only the live row decides.
  const live = deps.getCard(cardId);
  if (!live) return { ok: false, error: deps.errors.cardNotFound };
  const raced = promptEditRefusal(live);
  if (raced) return { ok: false, error: raced };
  // Single-burst-site rule: a prompt save never spawns the title burst.
  // When the title is still the heuristic of the prompt being replaced it
  // is recomputed from the new prompt in the same write; a human-set title
  // is left untouched.
  const title = needsNaming({ displayName: live.display_name ?? live.name, name: live.name, prompt: live.prompt })
    ? heuristicDisplayName(next, live.name)
    : live.display_name;
  deps.db.prepare("UPDATE cards SET prompt = ?, display_name = ?, updated_at = ? WHERE id = ?")
    .run(next, title, deps.now(), cardId);
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

async function updateCardWorkspace(
  deps: CardMutationDeps,
  { cardId, projectId }: { cardId: string; projectId: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  if (isArchivedCard(card)) return { ok: false, error: ERR_CARD_ARCHIVED };
  if (card.status === "completed") return { ok: false, error: ERR_CARD_COMPLETED };
  if (card.worker_thread_id) return { ok: false, error: ERR_CARD_STARTED };
  if (!PARKED_STATUSES.has(card.status)) return { ok: false, error: ERR_CARD_STARTED };
  const live = deps.getCard(cardId);
  if (!live) return { ok: false, error: deps.errors.cardNotFound };
  const raced = promptEditRefusal(live);
  if (raced) return { ok: false, error: raced };
  deps.db.prepare("UPDATE cards SET project_id = ?, updated_at = ? WHERE id = ?").run(projectId, deps.now(), cardId);
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

type CommentDelivery = "sent" | "queued" | "rides-answer";

async function addCardComment(
  deps: CardMutationDeps,
  input: {
    cardId: string;
    target: "card" | "scope" | "task";
    targetId: string;
    body: string;
  },
) {
  const { cardId, target, targetId, body } = input;
  const card = deps.getCard(cardId);
  if (!card) {
    return { commentId: "", error: deps.errors.cardNotFound, delivery: null, deliveryLine: null };
  }
  if (isArchivedCard(card)) {
    return { commentId: "", error: ERR_CARD_ARCHIVED, delivery: null, deliveryLine: null };
  }
  const commentId = deps.logCardComment(cardId, target, targetId, "user", body);
  const routed = await routeCommentToWorker(deps, card, target, body, commentId);
  if (routed.error) {
    return { commentId, error: routed.error, delivery: routed.delivery, deliveryLine: routed.line };
  }
  deps.bb.realtime.publish("card-state", { cardId });
  return { commentId, error: null, delivery: routed.delivery, deliveryLine: routed.line };
}

/**
 * Whether to wake the worker with this comment now, and what to say about it.
 *
 * A comment written while the card waits on an answer rides that answer: sending
 * it now wakes the worker mid-read, so the person's picks arrive as a second
 * turn and the first turn acts on half a thought. The row is already written and
 * stays unstamped, so the answer carries it later
 * (`server/runtime/answer-feedback.ts`). Nothing is lost if the answer never
 * comes — the comment is on the card either way.
 */
async function routeCommentToWorker(
  deps: CardMutationDeps,
  card: WorkerCard,
  target: "card" | "scope" | "task",
  body: string,
  commentId: string,
): Promise<{ error: string | null; delivery: CommentDelivery | null; line: string | null }> {
  if (target !== "card" || !targetIsLiveWorker(card)) {
    return { error: null, delivery: null, line: null };
  }
  if (answerFeedbackHolds({ activity: card.activity, openExpired: openExpiredCount(deps.db, card.id) })) {
    // `sent` is not the verdict here: the comment is carried by an answer the
    // person has not given yet.
    return { error: null, delivery: "rides-answer", line: commentDeliveryLine("rides-answer", null) };
  }
  return await deliverComment(deps, card, body, commentId);
}

/** Send it now, and stamp it carried only when the host actually dispatched it. */
async function deliverComment(
  deps: CardMutationDeps,
  card: WorkerCard & { worker_thread_id: string },
  body: string,
  commentId: string,
): Promise<{ error: string | null; delivery: CommentDelivery | null; line: string | null }> {
  const dispatch = await sendWorkerInput(deps.bb, card.worker_thread_id, [
    { type: "text", text: `User comment on card "${card.name}":\n\n${body}`, mentions: [] },
  ]);
  if (dispatch.delivery === "refused") return { error: dispatch.error, delivery: null, line: null };
  if (dispatch.delivery === "queued") {
    // The host took it and dispatches it on its own. Stamping it carried now
    // would claim a delivery that has not happened and keep it from ever riding
    // an answer that could have carried it.
    deps.updateCard(card.id, holdUpdates(card.last_assistant_text));
    return { error: null, delivery: "queued", line: commentDeliveryLine("queued", dispatch.hold) };
  }
  deps.db
    .prepare("UPDATE comments SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL")
    .run(deps.now(), commentId);
  const resume = statusForNewCardWork({ kind: card.kind, status: card.status, stage: card.stage });
  deps.updateCard(card.id, { activity: "running", status: resume.status });
  return { error: null, delivery: "sent", line: null };
}

function targetIsLiveWorker(card: WorkerCard): card is WorkerCard & {
  worker_thread_id: string;
} {
  return Boolean(card.worker_thread_id);
}
