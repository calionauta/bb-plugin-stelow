import { projectIdleTimestamp, projectNoProgress } from "./thread-state-projection.js";
import { recordPausedAfter } from "./paused-inbox.js";
import type { WorkerCard } from "../workers-types.js";

/**
 * What a card is written as when it parks with unfinished work.
 *
 * Its own module because parking is a distinct decision from deciding to park,
 * and because the sync file that makes the decision had no room left to also
 * describe what the park looks like. Every reader of the card meets this
 * sentence; the sync only chooses to call it.
 *
 * It is also the LAST place that can still be honest about a card that stopped.
 * By the time this runs the host has been asked to resume and declined, the
 * budget is spent or vetoed, and the only remaining truth available is what the
 * thread did — so the comment below is written for the person who reads the
 * card next, and names the inspection that would actually help.
 */
export type ParkDeps = {
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  logComment: (cardId: string, body: string) => void;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  recordInbox: (
    card: WorkerCard,
    kind: "paused",
    message: string,
    key: string,
    at: number,
  ) => void;
  idleAttentionMs: number;
};

export type ParkSnapshot = {
  card: WorkerCard;
  lastOutput: string | null;
};

export function persistStandardIdle(
  deps: ParkDeps,
  snapshot: ParkSnapshot,
  transitioning: boolean,
  vetoed: boolean,
): void {
  const noProgress = projectNoProgress(
    snapshot.card,
    transitioning,
    snapshot.lastOutput,
  );
  if (noProgress) {
    deps.logComment(
      snapshot.card.id,
      "Worker stopped with no new output — treated as paused. If this repeats, inspect " +
      "the thread before retrying: a silent stop usually means the worker is waiting on " +
      "input it never asked for.",
    );
  }
  const idleAt = projectIdleTimestamp(
    snapshot.card,
    transitioning,
    noProgress,
    deps.now(),
    deps.idleAttentionMs,
  );
  deps.updateCard(snapshot.card.id, {
    activity: "idle",
    last_assistant_text: snapshot.lastOutput,
    last_error: null,
    last_idle_at: idleAt,
  });
  if (idleAt == null) return;
  const suffix = vetoed
    ? " Auto-continue vetoed the resume: the last output showed no real progress."
    : "";
  recordPausedAfter(
    deps,
    snapshot.card.id,
    idleAt,
    `Idle with unfinished work — retry continues in place, restart begins fresh.${suffix}`,
  );
}
