import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { reactivateRestorePending } from "../../lib/card-restore-pending.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type RestoreCardDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  updateCard: (
    cardId: string,
    values: Record<string, unknown>,
    options?: { suppressCompletionEvent?: boolean; restoreFromArchive?: boolean },
  ) => void;
  workers: {
    fresh: (cardId: string, reason: "start" | "restart") => Promise<{
      ok: boolean;
      error: string | null;
    }>;
  };
  errors: { cardNotFound: string };
};

// No previous-status column exists, so the target is derived the same way
// movePhase derives it: draft at triage, in-progress everywhere else. The
// stage itself is untouched — restore never re-enters the phase.
export function restoreTargetStatus(stage: string): string {
  return stage === "triage" ? "draft" : "in-progress";
}

// Restore is NOT a moveCard target. It is a separate, named, confirmed
// action: only a person holding this RPC can open the archived door, and no
// poll, event, or error path carries the restoreFromArchive flag.
export async function restoreCard(
  deps: RestoreCardDeps,
  { cardId }: { cardId: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  if (card.status !== "archived") {
    return {
      ok: false,
      error: "This card is not archived — restoreCard only restores archived cards.",
    };
  }
  const previous = { stage: card.stage, status: card.status };
  deps.updateCard(
    cardId,
    { status: restoreTargetStatus(card.stage) },
    { restoreFromArchive: true },
  );
  // The status must flip before the spawn: workers.fresh refuses archived
  // cards. A failed spawn rolls back so the card never claims in-progress
  // with no worker — a phantom wait is a bug, not a partial success.
  const started = await deps.workers.fresh(cardId, "restart");
  if (!started.ok) {
    deps.updateCard(cardId, previous);
    return { ok: false, error: started.error };
  }
  reactivateRestorePending(deps.db, {
    cardId,
    lastError: card.last_error,
    occurredAt: deps.now(),
  });
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}
