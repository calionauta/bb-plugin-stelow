/**
 * Persist an unanswered card question.
 *
 * A timeout, a plugin reload, or an aborted request means the person simply
 * never answered; the question must stay answerable on the card instead of
 * vanishing with the interaction. The write is retried once for a transient
 * SQLITE_BUSY, and a failure that cannot be recorded is reported on the card
 * and in the inbox rather than left as a phantom wait.
 *
 * Extracted from `cli-ask` so the command file stays a decision flow.
 */
import { interruptionWhy, isRetryablePersistError } from "../../../lib/question-gate.mjs";
import { kickQuestionSync } from "../../../lib/question-store.mjs";
import {
  persistFailureInboxEvent,
  persistFailureTrailLine,
  shouldRecordPersistFailure,
} from "../../../lib/question-evidence.mjs";
import type { AskGroup } from "./cli-ask-gate.js";
import type { CliResult } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";

type Requested = {
  result: { outcome: string; reason: string | null };
  failed: boolean;
};

/** Tell the reader, on the card and in the inbox, that a question could not be recorded. */
function recordPersistFailure(
  deps: CliDeps,
  cardId: string,
  threadId: string,
  whyPersistFailed: string,
  persistError: string | null,
): void {
  if (!shouldRecordPersistFailure({ persisted: false, error: persistError })) return;
  const cause = `${whyPersistFailed}${persistError ? `; ${persistError}` : ""}`;
  try {
    deps.logCardComment(
      cardId,
      "card",
      cardId,
      "agent",
      persistFailureTrailLine({ threadId, error: cause }),
    );
    const event = persistFailureInboxEvent({ cardId, error: cause });
    deps.recordInboxEvent(event.card, event.kind, event.summary, event.dedupeKey, deps.now());
  } catch {
    // Never replace the failure with a report about the failure.
  }
}

/** Write the expired-question rows, twice if the first failure looks transient. */
async function tryPersistUnanswered(
  deps: CliDeps,
  cardId: string,
  threadId: string,
  groups: AskGroup[],
  askedAt: number,
  timeoutMs: number,
): Promise<{ persisted: boolean; persistError: string | null }> {
  let persisted = false;
  let persistError: string | null = null;
  for (let attempt = 1; attempt <= 2 && !persisted; attempt++) {
    try {
      writeExpiredRows(deps, cardId, threadId, groups, askedAt, timeoutMs);
      persisted = true;
    } catch (err) {
      persistError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      deps.bb.log.warn(
        `stelow ask persist attempt ${attempt}/2 failed (card ${cardId}, thread ${threadId}): ${persistError}`,
      );
      if (isRetryablePersistError(persistError) && attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      } else {
        break;
      }
    }
  }
  return { persisted, persistError };
}

export async function persistUnanswered(
  deps: CliDeps,
  cardId: string,
  threadId: string,
  groups: AskGroup[],
  askedAt: number,
  requested: Requested,
  timeoutMs: number,
): Promise<CliResult> {
  const cancelReason =
    requested.result.outcome === "cancelled" ? requested.result.reason : null;
  const { persisted, persistError } = await tryPersistUnanswered(
    deps,
    cardId,
    threadId,
    groups,
    askedAt,
    timeoutMs,
  );
  const elapsed = Math.round((deps.now() - askedAt) / 1e3);
  if (!persisted) {
    const whyPersistFailed = requested.failed
      ? "request failure"
      : `cancel reason "${cancelReason ?? "unknown"}"`;
    // The failure must leave a record, not only a log line. The card was marked
    // `awaiting-answer` before the blocking wait and is set back to running when the call
    // ends — which happens BEFORE this persist — so an unrecorded failure leaves a card
    // that is idle, has no pending question, and shows no trace of what happened.
    recordPersistFailure(deps, cardId, threadId, whyPersistFailed, persistError);
    return {
      exitCode: 1,
      stdout: `The question could not be recorded (interrupted storage after ${whyPersistFailed}). STOP and wait: do NOT proceed with the workflow. \
On your next turn, if no pending question exists on the card, ask it ONCE more via bb stelow ask.`,
    };
  }
  const why = interruptionWhy(cancelReason, requested.failed, elapsed);
  return {
    exitCode: 1,
    stdout: `${why} STOP and wait: do NOT proceed with the workflow. The question is still pending on the card (same column, marked as waiting \
for your answer) and remains answerable. When the user answers it on the card, the answer is delivered here as a message and you \
may continue. If you are re-asked about this same question later, do not re-ask the user again — wait for the card answer.`,
  };
}

/** A timed-out batch persists as one expired row per sub-question. */
function writeExpiredRows(
  deps: CliDeps,
  cardId: string,
  threadId: string,
  groups: AskGroup[],
  askedAt: number,
  timeoutMs: number,
): void {
  const expiredAt = askedAt + timeoutMs;
  const insert = deps.db.prepare(
    "INSERT OR REPLACE INTO expired_questions (id, card_id, thread_id, question, multiple, kind, options, expired_at, answered) \
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  deps.db.transaction(() => {
    for (const group of groups) {
      insert.run(
        deps.randomId("qexp"),
        cardId,
        threadId,
        group.question,
        group.multiple ? 1 : 0,
        group.kind,
        JSON.stringify(group.options),
        expiredAt,
        0,
      );
    }
  })();
  deps.updateCard(cardId, { activity: "awaiting-answer" });
  deps.bb.realtime.publish("card-state", { cardId });
  // Expired rows are answerable immediately; mint their inbox row now
  // instead of on the next tick (same kick as the live path).
  kickQuestionSync(deps, { threadId, cardId });
}
