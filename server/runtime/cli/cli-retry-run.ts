import { getExecutionRun } from "../../../lib/execution-run-ledger.mjs";
import { flagValue } from "../../../lib/cli-argv.mjs";
import type { RetryResult } from "../../execution-lifecycle-retry.js";
import {
  noCardInContext,
  usage,
  type CliCommandFn,
  type CliResult,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow retry-run --run <exec_id>";

/** A worker's own Retry button.
 *
 * The failed-run hold names "Retry run" as its door, but the only hand on
 * that door was the human's UI button: no `bb stelow` verb reached the
 * lifecycle retrier, so a worker told "retry" could only yield and wait for
 * a host retry that does not exist (card_a9q5zhzd did exactly that). This
 * verb runs the SAME retrier through the SAME refusals — unknown run,
 * foreign card, archived card, a run that is still working — and the new
 * run releases the hold the moment it starts, like every other retry.
 */
export function createRetryRunCommand(deps: RetryRunDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "retry-run") return null;
    const runId = flagValue(argv, "--run");
    if (!runId) return usage(USAGE);
    const card = ctx.threadId ? deps.getCardByWorkerThread(ctx.threadId) : undefined;
    if (!card) return noCardInContext();
    const run = getExecutionRun(deps.db, runId);
    if (!run) return { exitCode: 1, stderr: `Execution run "${runId}" not found.` };
    if (run.cardId !== card.id) {
      return {
        exitCode: 1,
        stderr: `Run ${runId} belongs to another card — a worker retries only its own card's runs.`,
      };
    }
    return runRetry(deps, card, runId);
  };
}

type RetryRunDeps = Pick<CliDeps, "db" | "getCardByWorkerThread" | "retryExecutionRun">;

async function runRetry(
  deps: RetryRunDeps,
  card: WorkerCard,
  runId: string,
): Promise<CliResult> {
  let result: RetryResult;
  try {
    result = await deps.retryExecutionRun({ runId });
  } catch (error) {
    return { exitCode: 1, stderr: error instanceof Error ? error.message : "Unable to retry the native run." };
  }
  if (!result.ok || !result.runId) return { exitCode: 1, stderr: result.error ?? "Unable to retry the native run." };
  return {
    exitCode: 0,
    stdout: `Retrying as ${result.runId} (previous run ${runId}). `
    + `The stage hold releases while the retry runs; it re-tightens if the retry fails. Card ${card.id} republished.`,
  };
}
