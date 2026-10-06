/**
 * The host-driven retry: the reconciler's answer to a failure nobody needs to
 * see.
 *
 * A run the host proved did nothing (see `lib/transient-run-retry.mjs` for the
 * proof and the surveyed exclusions) is retried through the SAME launch rule a
 * manual Retry uses (`startNativeStageForCard`), so it inherits every refusal —
 * unknown recipe, a card that moved on, a card that already owns a live run —
 * instead of growing a second launch path. The failed row is left untouched:
 * terminal states accept no transitions, and the new run carries the spent
 * budget forward, so a second consecutive no-op parks the card instead of
 * looping.
 *
 * Fail-soft by design: a launch refusal or a throw means "stay parked", never
 * "fail the pass". The failure is already recorded on the failed row and its
 * trail comment; an auto-retry that cannot start adds no new fact.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { MAX_AUTO_RETRIES } from "../lib/transient-run-retry.mjs";
import { refusalNeedsAttention, refusalRecord, retryDecision } from "../lib/retry-decision.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import type { ExecutionNative } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type AutoRetryDeps = {
  db: Db;
  getCard: (cardId: string) => WorkerCard | undefined;
  logComment: (cardId: string, targetId: string, body: string) => void;
  publishCard: (cardId: string) => void;
  native: ExecutionNative;
  /** Optional: present in the runtime wiring, absent in narrow tests. */
  noteInboxEvent?: (cardId: string, body: string) => void;
};

export type AutoRetryResult = { retried: boolean; runId: string | null };

/**
 * Record a refused retry on the card, and page a person only when the refusal
 * leaves them a decision.
 *
 * The record is the point. A refusal that only reaches a log file is invisible to
 * the person looking at the card, and this project's rule is that every background
 * operation leaves an openable record naming the outcome. Measured before this
 * existed: five runs failed with "the recipe produced no task outputs" and all five
 * reached the stage guard with the card already advanced, so every one was refused
 * with a bare `return idle` and `auto_retry_count` read 0 across the fleet.
 *
 * A card with nowhere to write (it no longer exists) is the one case that stays
 * silent, and that is "cannot record" rather than "chose not to".
 */
function recordRefusal(
  deps: AutoRetryDeps,
  failedRun: ExecutionRun,
  card: WorkerCard | undefined,
  decision: { recordable: boolean; reason: string | null; exit: string | null },
): void {
  const record = refusalRecord({
    reason: decision.reason,
    exit: decision.exit,
    recipeId: failedRun.recipeId,
    runId: failedRun.id,
    recordable: decision.recordable,
  });
  if (!record || !card) return;
  deps.logComment(card.id, failedRun.id, record);
  deps.publishCard(card.id);
  // Only a refusal that leaves a person a DECISION pages them. A card that moved on
  // resolves itself and must not become inbox noise.
  if (refusalNeedsAttention(decision.reason) && deps.noteInboxEvent) {
    deps.noteInboxEvent(card.id, record);
  }
}

export async function attemptAutoRetry(
  deps: AutoRetryDeps,
  failedRun: ExecutionRun,
): Promise<AutoRetryResult> {
  const idle: AutoRetryResult = { retried: false, runId: null };
  const card = deps.getCard(failedRun.cardId);
  // One decision, computed in lib/retry-decision.mjs, so every refusal carries a
  // reason AND an exit. It used to be four bare `return idle` statements, and the
  // stage guard among them refused five real runs without recording anything —
  // measured: every no-op failure in the live database reached here with the card
  // already on a later stage, so the retry was declined and the card went on
  // looking like work in progress.
  const decision = retryDecision({
    errorCode: failedRun.errorCode,
    autoRetryCount: failedRun.autoRetryCount ?? 0,
    cardStage: card?.stage,
    runStage: failedRun.stage,
    cardExists: Boolean(card),
    cardArchived: Boolean(card && isArchivedCard(card)),
  });
  if (!decision.retry) {
    recordRefusal(deps, failedRun, card, decision);
    return idle;
  }
  const attempt = (failedRun.autoRetryCount ?? 0) + 1;
  // Narrowed once, here: every path below runs only after the decision proved a
  // real, non-archived card on the failed stage, so the handler does not have to
  // re-assert it at each use.
  const liveCard = card as NonNullable<typeof card>;
  let started;
  try {
    started = await deps.native.startNativeStageForCard(
      liveCard,
      failedRun.recipeId,
      { prompt: liveCard.prompt },
      liveCard.stage,
    );
  } catch {
    // Fail-soft stays: the launch caller already reported this refusal, so a second
    // report from here would double-count it.
    return idle;
  }
  if (!started.run) return idle;
  // The budget stamp is a same-state evidence patch — the one write the
  // ledger allows without a state move — so the count travels with the chain.
  return recordRetry(deps, failedRun, liveCard, started.run, attempt);
}

/**
 * Stamp the spent budget and leave the retry's record.
 *
 * Extracted for the repository's function budget, and it reads better apart: the
 * budget stamp is a same-state evidence patch (the one write the ledger allows
 * without a state move), so the count travels with the chain and a second
 * consecutive no-op parks instead of looping.
 */
function recordRetry(
  deps: AutoRetryDeps,
  failedRun: ExecutionRun,
  card: WorkerCard,
  run: ExecutionRun,
  attempt: number,
): AutoRetryResult {
  transitionExecutionRun(deps.db, run.id, run.normalizedStatus, { autoRetryCount: attempt });
  deps.logComment(
    card.id,
    run.id,
    `Native ${failedRun.recipeId} produced no task outputs, so the host retried it `
    + `automatically (attempt ${attempt} of ${MAX_AUTO_RETRIES}, previous run ${failedRun.id}). `
    + "If this retry fails too, the card parks and Retry run remains available.",
  );
  deps.publishCard(card.id);
  return { retried: true, runId: run.id };
}
