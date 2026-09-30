/**
 * The one place a card becomes a paused inbox item.
 *
 * Two callers need it — the terminal-stage park and the mid-workflow park —
 * and a third copy is how two surfaces end up disagreeing about when a pause
 * is worth telling a reader about. So the rule lives here: a pause is
 * recorded once the card has been idle past the attention window (a reader
 * who is already looking is not being interrupted), and never for a card that
 * is archived or completed, because neither has anything left to resume.
 */
import type { WorkerCard } from "../workers-types.js";

type PausedInboxDeps = {
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  recordInbox: (
    card: WorkerCard,
    kind: "paused",
    message: string,
    key: string,
    at: number,
  ) => void;
  idleAttentionMs: number;
};

export function recordPausedAfter(
  deps: PausedInboxDeps,
  cardId: string,
  idleAt: number,
  message: string,
): void {
  if (!idleAt || deps.now() - idleAt < deps.idleAttentionMs) return;
  const current = deps.getCard(cardId);
  if (!current || current.status === "archived" || current.status === "completed") return;
  deps.recordInbox(current, "paused", message, `paused:${cardId}:${idleAt}`, idleAt);
}
