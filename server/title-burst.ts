/**
 * The card-title burst: spawn, classify, retry, record.
 *
 * Extracted from server/drafting.ts, which sits under a hard 400-line budget
 * (357 lines after this extraction) and could not absorb the title path inline. Everything
 * that decides *what happened* lives in lib/title-outcome.mjs as a pure
 * function; this module only sequences the calls and owns the side effects.
 *
 * Invariants that must survive any edit here:
 *  - a human rename always wins, and a renamed card gets no record
 *  - exactly one record per burst, never one per attempt
 *  - the retry fires only on a timeout, never on an errored thread
 *  - a comment and a publish each get their own try/catch, so neither can be
 *    reported as a delivery failure
 */
import { buildCardNamePrompt, validateCardName } from "../lib/draft-burst.mjs";
import {
  classifyTitleOutcome,
  isRecordable,
  isRetryable,
  titleOutcomeComment,
} from "../lib/title-outcome.mjs";
import type { TitleOutcome } from "../lib/title-outcome.mjs";

const TITLE_POLL_MS = 5_000;
// Every title burst that has ever landed did so inside 30.3s (n=19), so 24
// polls is ~4x the observed p100 of a success — room for a burst merely queued
// behind siblings — and matches the draft path's own 180s worst case.
const TITLE_POLLS = 24;
// The retry keeps its own, shorter budget: a retry that waits as long as the
// first attempt is not a retry.
const TITLE_RETRY_POLLS = 12;
// Process-wide, because what is bounded is host concurrency, not any one card.
const TITLE_RETRY_INFLIGHT = 2;

type TitleCard = { id: string; project_id: string; prompt: string; kind: string; display_name: string | null; name: string };

type TitleBurstDeps = {
  getCard: (cardId: string) => TitleCard | null | undefined;
  isArchivedCard: (card: TitleCard) => boolean;
  resolveGenerationPreset: (card: TitleCard) => { preset: { id: string; name: string }; source: string | null };
  presetParams: (preset: { id: string; name: string }) => Record<string, unknown>;
  stopThread: (threadId: string) => Promise<void>;
  comment: (cardId: string, body: string) => void;
  publish: (event: string, payload: { cardId: string }) => void;
  readOutput: (threadId: string) => Promise<string>;
  waitForThread: (threadId: string, polls: number, pollMs: number) => Promise<{ status: string; timedOut: boolean }>;
  writeTitle: (cardId: string, name: string) => void;
  log: (message: string) => void;
  spawnTitle: (card: TitleCard, params: Record<string, unknown>) => Promise<{ id: string }>;
};

let retriesInFlight = 0;

function titleOf(card: TitleCard): string {
  return card.display_name ?? card.name;
}

/** One burst, start to finish. Never throws: a failure is an outcome, not an exception. */
async function runAttempt(
  deps: TitleBurstDeps,
  card: TitleCard,
  params: Record<string, unknown>,
  polls: number,
): Promise<{ outcome: TitleOutcome; name: string | null }> {
  const originalTitle = titleOf(card);
  let thread: { id: string };
  try {
    thread = await deps.spawnTitle(card, params);
  } catch {
    return { outcome: "spawn_failed", name: null };
  }
  const completion = await deps.waitForThread(thread.id, polls, TITLE_POLL_MS);
  const ended = completion.status === "failed" || completion.status === "error" || completion.timedOut;
  const output = ended ? "" : await deps.readOutput(thread.id);
  await deps.stopThread(thread.id).catch(() => undefined);
  const validated = ended ? null : validateCardName(output);
  const live = deps.getCard(card.id);
  const outcome = classifyTitleOutcome({
    spawned: true,
    completion,
    output,
    validated,
    live: live ? { title: titleOf(live) } : null,
    originalTitle,
    archived: live ? deps.isArchivedCard(live) : false,
  });
  return { outcome, name: outcome === "delivered" ? validated?.name ?? null : null };
}

/**
 * The single trail line.
 *
 * The archived check is NOT redundant. `deps.comment` is bound straight to
 * `ledger.logCardComment`, bypassing `addCardComment`'s ERR_CARD_ARCHIVED
 * refusal, so an archived card would otherwise receive a write that the
 * terminality contract exists to prevent.
 */
function record(deps: TitleBurstDeps, cardId: string, outcome: TitleOutcome, context: Record<string, unknown>): boolean {
  if (!isRecordable(outcome)) {
    // The three unrecordable outcomes are the ones a card cannot carry: a
    // deleted card has no row, and a human-renamed or archived card must take
    // no write. They still have to be countable somewhere, or an unlogged exit
    // is an uncountable exit — the defect this whole card exists to remove.
    deps.log(`title ${cardId}: ${outcome} (no trail comment by design)`);
    return false;
  }
  const body = titleOutcomeComment(outcome, context);
  if (!body) return false;
  const current = deps.getCard(cardId);
  if (!current) return false;
  if (deps.isArchivedCard(current)) {
    deps.log(`title ${cardId}: ${outcome} not recorded, the card is archived`);
    return false;
  }
  try {
    deps.comment(cardId, body);
  } catch {
    // A record that cannot be written is not a reason to fail delivery — but it
    // IS a reason the tally is now short. Say so, or the failure disappears
    // exactly the way this card was opened to end.
    deps.log(`title ${cardId}: ${outcome} could NOT be recorded — ${body}`);
    return false;
  }
  return true;
}

function refresh(deps: TitleBurstDeps, cardId: string): void {
  try {
    deps.publish("card-state", { cardId });
  } catch {
    // A failed refresh is not a delivery failure.
  }
}

export function createTitleBurst(deps: TitleBurstDeps) {
  return async function suggestCardName(cardId: string): Promise<void> {
    const card = deps.getCard(cardId);
    if (!card) return;
    let outcome: TitleOutcome;
    let retried = false;
    let context: Record<string, unknown> = { presetName: "unknown", presetSource: null, retried: false };
    try {
      const resolution = deps.resolveGenerationPreset(card);
      const params = deps.presetParams(resolution.preset);
      context = { presetName: resolution.preset.name, presetSource: resolution.source, retried: false };
      const first = await runAttempt(deps, card, params, TITLE_POLLS);
      outcome = first.outcome;
      if (first.outcome === "delivered" && first.name) deps.writeTitle(cardId, first.name);
      if (isRetryable(outcome) && retriesInFlight < TITLE_RETRY_INFLIGHT) {
        // Re-read before retrying: a post-hoc comparison can only see a rename
        // that already happened, never one that is about to. The archived AND
        // renamed checks are both required — a retry must never overwrite a
        // human's name, and must never write to a terminal card.
        const current = deps.getCard(cardId);
        if (current && !deps.isArchivedCard(current) && titleOf(current) === titleOf(card)) {
          retried = true;
          retriesInFlight++;
          try {
            const second = await runAttempt(deps, current, params, TITLE_RETRY_POLLS);
            outcome = second.outcome;
            if (second.outcome === "delivered" && second.name) {
              deps.writeTitle(cardId, second.name);
              outcome = "delivered_after_retry";
            }
          } finally {
            retriesInFlight--;
          }
        }
      }
      const wrote = outcome === "delivered" || outcome === "delivered_after_retry";
      if (record(deps, cardId, outcome, { ...context, retried }) || wrote) refresh(deps, cardId);
    } catch {
      // The resolved preset and the retried flag are in scope even here, so
      // the record still names the evidence it was supposed to name.
      record(deps, cardId, "internal_error", { ...context, retried });
    }
  };
}
