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
import { MAX_AUTO_RETRIES, shouldAutoRetryRun } from "../lib/transient-run-retry.mjs";
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
};

export type AutoRetryResult = { retried: boolean; runId: string | null };

export async function attemptAutoRetry(
  deps: AutoRetryDeps,
  failedRun: ExecutionRun,
): Promise<AutoRetryResult> {
  const idle: AutoRetryResult = { retried: false, runId: null };
  if (!shouldAutoRetryRun({ errorCode: failedRun.errorCode, autoRetryCount: failedRun.autoRetryCount ?? 0 })) {
    return idle;
  }
  const card = deps.getCard(failedRun.cardId);
  if (!card || isArchivedCard(card)) return idle;
  // The stage the card has LEFT is not retried: re-running its recipe would
  // write that stage's artifacts over work the card has since done.
  if (card.stage !== failedRun.stage) return idle;
  const attempt = (failedRun.autoRetryCount ?? 0) + 1;
  let started;
  try {
    started = await deps.native.startNativeStageForCard(
      card,
      failedRun.recipeId,
      { prompt: card.prompt },
      card.stage,
    );
  } catch {
    return idle;
  }
  if (!started.run) return idle;
  // The budget stamp is a same-state evidence patch — the one write the
  // ledger allows without a state move — so the count travels with the chain.
  transitionExecutionRun(deps.db, started.run.id, started.run.normalizedStatus, { autoRetryCount: attempt });
  deps.logComment(
    card.id,
    started.run.id,
    `Native ${failedRun.recipeId} produced no task outputs, so the host retried it `
    + `automatically (attempt ${attempt} of ${MAX_AUTO_RETRIES}, previous run ${failedRun.id}). `
    + "If this retry fails too, the card parks and Retry run remains available.",
  );
  deps.publishCard(card.id);
  return { retried: true, runId: started.run.id };
}
