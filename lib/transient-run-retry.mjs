// Which failed runs the host retries by itself, and which ones it parks on.
//
// The rule is proof, not optimism: a run is retried without asking only when
// the host proved nothing ran. An empty recipe output (`succeeded` with zero
// task outputs, e.g. wfr_848feb98 on card_a9q5zhzd finishing in 0.3s with no
// agent calls) is that proof — starting a fresh run cannot duplicate work
// that never happened.
//
// Surveyed and deliberately EXCLUDED, with the reason for each:
//
// - "the host stopped answering about this run" (unreachable): the native run
//   may still be working. A retry would fork two workers on one stage.
// - "native-start-failed": owned by the launch caller, which already reports
//   the error to whoever started it. Retrying here as well would double-spend.
// - "native-start-timeout" (no run id after 60s): absence of proof, not proof
//   of absence — the host may have started the run and lost the answer.
// - Any recipe-logic failure (a run that RAN and failed): retrying blind would
//   replay the same failure and burn agent budget. That stays a human decision.
//
// The budget is one automatic attempt per chain. A second consecutive no-op
// means something is systematically wrong with dispatch, and a machine looping
// on it is worse than a person looking at it once.

/** The one error the host proves needs no human: the recipe did nothing. */
export const EMPTY_OUTPUT_ERROR = "the recipe produced no task outputs";

/** Automatic attempts spent before the card parks and asks. */
export const MAX_AUTO_RETRIES = 1;

/**
 * Whether a failed run qualifies for a host-driven retry.
 *
 * `autoRetryCount` is the failed run's own count of attempts already spent to
 * produce it (0 for a first attempt): the retry stamps count + 1 on the new
 * row, so the budget travels with the chain and a manual retry resets it.
 */
export function shouldAutoRetryRun({ errorCode, autoRetryCount }) {
  if (typeof errorCode !== "string" || errorCode.trim() !== EMPTY_OUTPUT_ERROR) return false;
  const used = Number.isInteger(autoRetryCount) ? autoRetryCount : 0;
  return used < MAX_AUTO_RETRIES;
}
