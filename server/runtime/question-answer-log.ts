/**
 * The card door's answer record.
 *
 * The CLI door always had a dwell because it was blocked on the answer; the
 * card door had none, so an answer given on the card (the normal path after a
 * timeout) was measurable only as "an RPC happened". The inbox row is minted
 * when the question is observed — the same moment the card starts asking — and
 * is the one timestamp both doors share.
 *
 * Kept apart from the handlers so the wait/record rule is testable without the
 * interaction port, and so `question-answers.ts` stays readable.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ActionRecorder } from "./action-log-runtime.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

type AnswerLogDeps = {
  db: Db;
  actions?: ActionRecorder;
};

/**
 * When this card's oldest open question first reached the inbox. Null when the
 * read fails or no open row exists: an unknown wait is `null`, never zero.
 */
export function questionWaitStart(deps: AnswerLogDeps, cardId: string): number | null {
  try {
    const row = deps.db
      .prepare(
        "SELECT MIN(occurred_at) AS at FROM inbox_events"
        + " WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL",
      )
      .get(cardId) as { at?: number | null } | undefined;
    // SQLite's MIN() over zero rows is one row with a NULL column, and
    // Number(null) is 0 — which is a finite timestamp, not "unknown". Without
    // this guard the dwell of an answer with no open inbox row is ~55 years.
    const raw = row?.at;
    if (raw === null || raw === undefined) return null;
    const at = Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** One row per answered batch, from either door. */
export function recordCardAnswer(
  deps: AnswerLogDeps,
  cardId: string,
  threadId: string | null,
  via: "live" | "expired",
  decisions: number,
  askedAt: number | null,
): void {
  deps.actions?.record({
    kind: "question.answered",
    outcome: "ok",
    cardId,
    threadId,
    durationMs: askedAt === null ? null : Date.now() - askedAt,
    detail: { via, decisions },
  });
}
