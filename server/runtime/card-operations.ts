import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isClaimTerminal } from "../../lib/card-terminal.mjs";
import { resolveCardMove } from "../../lib/card-move.mjs";
import { splitActionState } from "../../lib/split-proposal.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import { holdSentence, holdUpdates } from "../../lib/host-hold.mjs";
import { restoreCard } from "./card-restore.js";
import { sendAgentInput, sendError } from "./thread-send.js";
import { readHostHold } from "./worker-hold.js";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

type CardOperationsDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  workers: {
    fresh: (cardId: string, reason: "start" | "restart") => Promise<{
      ok: boolean;
      error: string | null;
    }>;
    stop: (threadId: string | null) => Promise<unknown>;
  };
  updateCard: (
    cardId: string,
    values: Record<string, unknown>,
    options?: { suppressCompletionEvent?: boolean; restoreFromArchive?: boolean },
  ) => void;
  releaseClaims: (cardId: string) => Promise<void>;
  recordStageEvent: (cardId: string, stage: string) => void;
  cardStageSlug: (card: WorkerCard) => Promise<string | null>;
  fetchPendingAsks: (threadId: string) => Promise<unknown[] | null>;
  openExpiredQuestionIds: (cardId: string) => string[];
  logCardComment: (
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ) => string;
  resetAutoContinue: () => { count: number; stage: string | null };
  buildNudge: (card: WorkerCard) => string;
  buildContinueInput: (
    nudge: string,
    visibility: "public",
  ) => Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0]["input"];
  splitRequestNudge: string;
  phaseEntryStages: Record<string, string>;
  /**
   * Every stage to the phase that owns it, from the workflow catalog — NOT
   * derivable from `phaseEntryStages`, which only knows each phase's FIRST
   * stage. Reverse-engineering it from those would classify `critique` and miss
   * `plan-gate`, `shape`, `verification` and `audit`, which are exactly the
   * stages a card is actually sitting in when this matters.
   */
  stagePhases: Record<string, string>;
  errors: { cardNotFound: string; cardArchived: string };
};

export function createCardOperationsHandlers(deps: CardOperationsDeps) {
  return {
    retryWorker: (input: { cardId: string }) => retryWorker(deps, input),
    startWorker: (input: { cardId: string }) => startWorker(deps, input),
    restartWorker: (input: { cardId: string }) => restartWorker(deps, input),
    requestSplitProposal: (input: { cardId: string }) =>
      requestSplitProposal(deps, input),
    moveCard: (input: { cardId: string; status: string }) =>
      moveCard(deps, input),
    restoreCard: (input: { cardId: string }) => restoreCard(deps, input),
  };
}

async function retryWorker(
  deps: CardOperationsDeps,
  { cardId }: { cardId: string },
) {
  const card = deps.getCard(cardId);
  if (!card?.worker_thread_id)
    return { ok: false, error: "This card has no worker thread." };
  if (card.status === "archived")
    return { ok: false, error: deps.errors.cardArchived };
  if (card.status === "completed" || card.status === "blocked") {
    return {
      ok: false,
      error: "This card is completed — comment on it to reopen, or restart fresh.",
    };
  }
  // The card is held, so its next message is already queued and waiting for the
  // host. Resuming would queue a SECOND copy of a message that is about to be
  // delivered on its own — the button the card used to show in exactly this
  // state. Refuse, and name what releases it: a refusal without an exit is a
  // deadlock with a good error message.
  const hold = await readHostHold(deps.bb, card.worker_thread_id);
  if (hold) return { ok: false, error: holdSentence(hold) };
  const dispatch = await sendAgentInput(
    deps.bb,
    card,
    deps.buildContinueInput(deps.buildNudge(card), "public"),
  );
  if (dispatch.delivery === "refused") {
    return { ok: false, error: dispatch.error };
  }
  if (dispatch.delivery === "queued") {
    // The host took it between the read and the send. Same card state as any
    // other hold, and the budget is untouched for the same reason.
    deps.updateCard(cardId, holdUpdates(card.last_assistant_text));
    deps.bb.realtime.publish("card-state", { cardId });
    return { ok: false, error: holdSentence(dispatch.hold) };
  }
  const reset = deps.resetAutoContinue();
  deps.updateCard(cardId, {
    activity: "running",
    last_error: null,
    auto_continue_count: reset.count,
    auto_continue_stage: reset.stage,
  });
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

function startWorker(
  deps: CardOperationsDeps,
  { cardId }: { cardId: string },
) {
  return deps.workers.fresh(cardId, "start");
}

function restartWorker(
  deps: CardOperationsDeps,
  { cardId }: { cardId: string },
) {
  return deps.workers.fresh(cardId, "restart");
}

async function requestSplitProposal(
  deps: CardOperationsDeps,
  { cardId }: { cardId: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  if (isArchivedCard(card))
    return { ok: false, error: deps.errors.cardArchived };
  if (!card.worker_thread_id)
    return { ok: false, error: "This card has no worker thread." };
  const open = deps.db
    .prepare("SELECT 1 FROM split_proposals WHERE card_id = ? AND selected IS NULL")
    .get(cardId);
  const live = (await deps.fetchPendingAsks(card.worker_thread_id)) ?? [];
  const refusal = await splitRefusal(deps, card, open, live);
  if (refusal) return { ok: false, error: refusal };
  try {
    await deps.bb.sdk.threads.send({
      threadId: card.worker_thread_id,
      mode: "auto",
      input: [{ type: "text", text: deps.splitRequestNudge, mentions: [] }],
    });
  } catch (error) {
    return { ok: false, error: sendError(error) };
  }
  deps.logCardComment(
    cardId,
    "card",
    cardId,
    "agent",
    "Split proposal requested — the worker will ask with --tag split.",
  );
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

async function splitRefusal(
  deps: CardOperationsDeps,
  card: WorkerCard,
  open: unknown,
  live: unknown[],
): Promise<string | null> {
  const action = splitActionState({
    kind: card.kind,
    stage: await deps.cardStageSlug(card),
    status: card.status,
    archived: false,
    openProposal: Boolean(open),
    openQuestions: live.length + deps.openExpiredQuestionIds(card.id).length,
    hasWorker: true,
  });
  return action.ok ? null : action.reason ?? "A split cannot be proposed on this card right now.";
}

async function moveCard(
  deps: CardOperationsDeps,
  { cardId, status }: { cardId: string; status: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  // Archived is terminal, and the guard is on the DESTINATION rather than the
  // card: nothing may move a card OUT of archived, but a card already there
  // being dropped back onto the archived column is a no-op, not a violation.
  // Reading it the other way made the most common drag in this UI — nudging a
  // card a few pixels and letting go where it already sat — answer "This card
  // is archived" for a move that changes nothing.
  if (isArchivedCard(card)) {
    if (status === "archived") return { ok: true, error: null };
    return { ok: false, error: deps.errors.cardArchived };
  }
  const decision = resolveCardMove(card.kind, status, {
    hasWorker: Boolean(card.worker_thread_id),
    // The card's real position. Without it the resolver cannot tell a one-phase
    // advance from a jump over the phases that produce the artifacts the target
    // is meant to review, and it used to permit the jump.
    stage: card.stage,
    stagePhases: deps.stagePhases,
    phaseEntryStages: deps.phaseEntryStages,
  });
  if (!decision.ok) return { ok: false, error: decision.error };
  const sameColumn = decision.move.type === "status"
    ? card.status === decision.move.status
    : card.stage === phaseEntryStage(deps, decision.move.phase);
  if (sameColumn) return { ok: true, error: null };
  if (decision.move.type === "status")
    return moveStatus(deps, card, cardId, decision.move.status);
  return movePhase(deps, card, cardId, decision.move.phase);
}

function phaseEntryStage(deps: CardOperationsDeps, phase: string): string | undefined {
  return deps.phaseEntryStages[phase];
}

async function moveStatus(
  deps: CardOperationsDeps,
  card: WorkerCard,
  cardId: string,
  status: string,
) {
  if (status === "archived") await deps.workers.stop(card.worker_thread_id);
  if (status === "in-progress" && !card.worker_thread_id) {
    const started = await deps.workers.fresh(cardId, "start");
    if (!started.ok) return { ok: false, error: started.error };
  }
  deps.updateCard(cardId, { status }, { suppressCompletionEvent: true });
  if (status === "completed") deps.recordStageEvent(cardId, "done");
  if (isClaimTerminal(status)) await deps.releaseClaims(cardId);
  return { ok: true, error: null };
}

async function movePhase(
  deps: CardOperationsDeps,
  card: WorkerCard,
  cardId: string,
  phase: string,
) {
  const entry = deps.phaseEntryStages[phase];
  if (!entry) return { ok: false, error: "Unknown phase." };
  const previous = { stage: card.stage, status: card.status };
  deps.updateCard(cardId, {
    stage: entry,
    status: entry === "triage" ? "draft" : "in-progress",
  });
  if (card.worker_thread_id) return { ok: true, error: null };
  const started = await deps.workers.fresh(cardId, "start");
  if (!started.ok) {
    deps.updateCard(cardId, previous);
    return { ok: false, error: started.error };
  }
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}
