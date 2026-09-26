import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isClaimTerminal } from "../../lib/card-terminal.mjs";
import { resolveCardMove } from "../../lib/card-move.mjs";
import { splitActionState } from "../../lib/split-proposal.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

type CardOperationsDeps = {
  db: Db;
  bb: BbPluginApi;
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
    options?: { suppressCompletionEvent?: boolean },
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
  try {
    await deps.bb.sdk.threads.send({
      threadId: card.worker_thread_id,
      mode: "auto",
      input: deps.buildContinueInput(deps.buildNudge(card), "public"),
    });
    const reset = deps.resetAutoContinue();
    deps.updateCard(cardId, {
      activity: "running",
      last_error: null,
      auto_continue_count: reset.count,
      auto_continue_stage: reset.stage,
    });
    deps.bb.realtime.publish("card-state", { cardId });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: retrySendError(error) };
  }
}

function retrySendError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not reach the worker thread.";
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
    return { ok: false, error: retrySendError(error) };
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
  if (isArchivedCard(card))
    return { ok: false, error: deps.errors.cardArchived };
  const decision = resolveCardMove(card.kind, status, {
    hasWorker: Boolean(card.worker_thread_id),
  });
  if (!decision.ok) return { ok: false, error: decision.error };
  if (decision.move.type === "status")
    return moveStatus(deps, card, cardId, decision.move.status);
  return movePhase(deps, card, cardId, decision.move.phase);
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
