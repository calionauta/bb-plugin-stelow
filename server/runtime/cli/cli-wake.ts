import { shouldWake } from "../../../lib/wake-gate.mjs";
import {
  noCardInContext,
  scanCardId,
  unknownCard,
  type CliCommandFn,
  type CliResult,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow wake [--card <card_id>] [--json]";

/**
 * The cheapest thing a scheduled visit can ask: should this tick spend a model
 * turn?
 *
 * This is the door the `script`-mode half of a supervision pair knocks on
 * (bb-plugin-stelow#385). A `bb automation` in `script` mode costs nothing and
 * runs on the host, but it knows nothing about a card; an `agent` mode one knows
 * the card but costs a full turn even when the answer is "nothing happened".
 * A script that runs `bb stelow wake` gets the card's answer for free, and the
 * host turns the answer into a skipped tick through its documented contract:
 * an exit-0 run whose last non-empty stdout line is `{"wakeAgent": false}` is
 * recorded as a silent skip and wakes nobody.
 *
 * Hence the shape of the output below. A refusal to wake prints exactly
 * `{"wakeAgent": false}`, which the host records as a skipped tick. A wake
 * prints the REASON, which does two things: it keeps the sentinel's run recorded
 * as a real success rather than a silent skip (empty stdout is also a skip, and
 * a skip hides the line that explains why a turn was worth spending), and it
 * leaves the reason in the run history for the person auditing cost.
 * `--json` is for a human or a debugger, not for the host contract.
 *
 * The intended sentinel is therefore three lines of shell:
 *
 *     out=$(bb stelow wake --card "$CARD")
 *     case "$out" in *wakeAgent*) echo "$out"; exit 0 ;; esac
 *     bb automation run "$WORKER_ID" --project "$PROJECT"
 *
 * A missing card is a loud exit 2, never a silent skip. A gate that skipped on a
 * misconfiguration (wrong card id, a renamed branch, a worker run outside its
 * thread) would hide the automation forever, and "the loop stopped and nothing
 * said why" is the failure mode this whole change exists to remove.
 */
export function createWakeCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "wake") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, { usage: USAGE });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    return verdictFor(deps, card, json);
  };
}

function verdictFor(deps: CliDeps, card: WorkerCard, json: boolean): CliResult {
  const { wake, reason } = shouldWake({
    status: card.status,
    activity: card.activity,
    lastError: card.last_error,
    lastIdleAt: card.last_idle_at,
    now: deps.now(),
    autoCount: card.auto_continue_count,
    // The latch, not the raw streak: the read channel writes
    // `read_miss_since` only once a card has missed enough reads to be worth
    // reporting, so its presence IS the "host is not answering" verdict and this
    // read does not need a second threshold to disagree with.
    readUnreachable: card.read_miss_since != null,
  });

  if (json) {
    return { exitCode: 0, stdout: JSON.stringify({ wake, reason, cardId: card.id }, null, 2) };
  }
  // The host's silent-skip contract, and the only line this command prints for
  // a refusal. Kept to exactly this shape: the automations plugin parses the
  // last non-empty stdout line as JSON and requires `wakeAgent === false`.
  if (!wake) return { exitCode: 0, stdout: '{"wakeAgent": false}' };
  // A wake prints its reason, so the sentinel's run is recorded as a success
  // with an explanation instead of a silent skip with none.
  return { exitCode: 0, stdout: reason };
}
