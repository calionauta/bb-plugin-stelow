// What an answer's resume actually did, as two facts kept apart.
//
// The answer is the person's act, and it is recorded before anything is sent.
// Waking the worker is the transport's act, and it has three outcomes: the host
// dispatched the message, the host queued it behind a hold, or the send failed
// with the host's own words. A person answering a blocked worker needs to tell
// those apart, because only one of them means work continues.
//
// The plugin collapsed them twice. `server/runtime/thread-send.ts` writes up the
// first collapse: a queued dispatch read as a successful resume, the card went
// `running`, and ten ticks later the auto-continue budget was gone for turns
// that never started. The answer door kept the same collapse with less to show
// for it — it awaited a raw `threads.send`, threw the verdict away entirely, and
// returned `{ ok: true }`. So the Inbox row resolved, the toast said nothing, and
// a reader who answered a paused worker learned only later, from a card that had
// not moved, that the answer had never woken anybody. The recovery door was
// worse: it swallowed a failed resume with `.catch(() => undefined)`.
//
// One rule, and it is the same one lib/host-hold.mjs keeps: a queued dispatch is
// a hold, not a resume, and a hold is never phrased as homework.
import { holdSentence, holdUpdates } from "./host-hold.mjs";

/**
 * The verdicts a dispatch can carry, in the order a reader cares about them.
 * `null` is not a fourth verdict; it is the absence of one — a caller that
 * handed over a dispatch in a shape this module does not know. It stays
 * distinct because "the host did not say" and "the host refused" are different
 * facts, and rendering the first as the second would be a confident lie in the
 * safe direction, which is still a lie.
 */
export const ANSWER_DELIVERIES = ["sent", "queued", "refused"];

/**
 * Read a dispatch into the facts the answer door needs.
 *
 * @param {{ delivery?: string, hold?: unknown, error?: string } | null | undefined} dispatch
 * @returns {{ delivery: "sent" | "queued" | "refused" | null, hold: unknown, error: string | null }}
 */
export function answerDeliveryOf(dispatch) {
  if (dispatch && dispatch.delivery === "sent") {
    return { delivery: "sent", hold: null, error: null };
  }
  if (dispatch && dispatch.delivery === "queued") {
    // A row the host queued without naming a wait is still a queue, and the
    // line degrades to the generic sentence rather than claiming a reason.
    return { delivery: "queued", hold: dispatch.hold ?? null, error: null };
  }
  if (dispatch && dispatch.delivery === "refused") {
    return {
      delivery: "refused",
      hold: null,
      error: typeof dispatch.error === "string" && dispatch.error.trim() ? dispatch.error : null,
    };
  }
  return { delivery: null, hold: null, error: null };
}

/**
 * The card fields an answer's verdict overrides, or null when the answer
 * patch's `running` is already the truth.
 *
 * The card is where these three verdicts differ most, and where the plugin used
 * to lie hardest: `answeredCardPatch` says `running` for every answer, so a
 * queued dispatch read as work in progress and a refused one read the same. A
 * reader then had a card claiming to work, no turn anywhere, and a reconciler
 * that eventually spent the auto-continue budget trying to recover a card that
 * had never stopped.
 *
 * @param {{ delivery: string | null } | null | undefined} verdict
 * @param {string | null} lastOutput the worker's last words, kept while held
 * @param {boolean} waiting the card still has open questions for the person.
 *   Such a card is neither running nor idle — it is waiting, and the open
 *   questions are the truth about what comes next, whatever the transport did
 *   with this batch — so the answer patch's activity stands.
 */
export function answerDeliveryCardPatch(verdict, lastOutput, waiting = false) {
  if (waiting) return null;
  if (!verdict || verdict.delivery === "sent") return null;
  if (verdict.delivery === "queued") return holdUpdates(lastOutput ?? null);
  // Refused, or nothing measured: nothing is running, and `idle` is the only
  // activity that says so without also claiming the card failed — the answers
  // are recorded, only the waking is not.
  return { activity: "idle" };
}

/**
 * The sentence to show beside a saved answer, or null when there is nothing to
 * add: a dispatched resume speaks for itself, and a second line confirming it
 * would be noise on the happy path.
 *
 * Every non-null line ends where the reader can act, because a refusal without
 * an exit is a deadlock with a good error message.
 *
 * @param {{ delivery: "sent" | "queued" | "refused" | null, hold: unknown, error: string | null }} verdict
 * @returns {string | null}
 */
export function answerDeliveryLine(verdict) {
  if (!verdict || verdict.delivery === "sent") return null;
  if (verdict.delivery === "queued") {
    // The hold's own sentence already says what releases it and that the reader
    // is not the one who has to. Composing a second claim here would be a
    // second source of truth about the host's queue.
    return "The answer is saved. "
      + (holdSentence(verdict.hold)
        ?? "The host is holding the worker's next message. The card continues on its own — no action needed.");
  }
  if (verdict.delivery === "refused") {
    // The host's words are quoted, never re-punctuated: mangling them is how a
    // message stops matching the log the reader will go looking for.
    return "The answer is saved, but the worker was not woken"
      + (verdict.error ? `: ${verdict.error}` : "")
      + " Resume the card to send it again — the answers do not need re-entering.";
  }
  return "The answer is saved. The host did not say whether the worker was woken, so this line says nothing about it.";
}
