/**
 * One browser failure, recorded so it stops dying in the console.
 *
 * Kept apart from the RPC table so the rule is testable without a host: the
 * table entry is one call, the decision (which cause, what to keep) is here.
 *
 * The cause is a fingerprint of the message, never the constant `ui.error`.
 * The recorder collapses rows by `(kind, outcome, cause, card)`; a constant
 * cause would turn every distinct browser failure in a ten-minute window into
 * one row with a count — the right number and the wrong answer. The message
 * and stack are capped here as well as by the recorder so a hostile stack
 * cannot crowd the row's other fields out of the 2 KB budget.
 *
 * Returns `{ ok: true }` unconditionally. A reporting call that failed because
 * reporting failed would be a second error in the UI that helps nobody; the
 * recorder itself already refuses to throw.
 */
import { clientErrorCause } from "../../lib/client-error-cause.mjs";
import type { ActionRecorder } from "./action-log-runtime.js";

export type ClientErrorReport = {
  surface: string;
  message: string;
  stack?: string;
  cardId?: string;
};

export function reportClientError(
  actions: ActionRecorder | undefined,
  input: ClientErrorReport,
): { ok: true } {
  actions?.record({
    kind: "ui.error",
    actor: "client",
    outcome: "error",
    cause: clientErrorCause(input.surface, input.message),
    cardId: input.cardId ?? null,
    detail: {
      surface: input.surface.slice(0, 40),
      message: input.message.slice(0, 400),
      stack: input.stack ? input.stack.slice(0, 1200) : null,
    },
  });
  return { ok: true };
}
