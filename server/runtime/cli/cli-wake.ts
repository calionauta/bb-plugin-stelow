import { shouldWake, wakeFingerprint } from "../../../lib/wake-gate.mjs";
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
 * The pair has one schedule, not two: the worker automation is created with
 * `--disabled` and the sentinel's cadence is the only thing that starts it.
 * Left on its own schedule the worker still pays a turn every tick and the gate
 * changes nothing.
 *
 * The gate also remembers the state it last woke a visit for, per card, and
 * refuses a repeat on an unchanged card. Without that it would answer "idle, so
 * yes" every tick, and an idle card whose worker keeps parking without advancing
 * a stage would be visited every 20 minutes forever — the same loop, one
 * sentinel later. A stage advance, a question, a new error or any other change
 * to the card's own fields is a new state and earns a new visit; the idle
 * timestamp alone is not, because the end of a visit is what moves it.
 *
 * A missing card is a loud exit 2, never a silent skip. A gate that skipped on a
 * misconfiguration (wrong card id, a renamed branch, a worker run outside its
 * thread) would hide the automation forever, and "the loop stopped and nothing
 * said why" is the failure mode this whole change exists to remove.
 */
export function createWakeCommand(deps: CliDeps): CliCommandFn {
  // The last state this gate woke a visit for, per card.
  //
  // In memory, like `createScopeProgressSync`'s fingerprints, and for the same
  // reason: a plugin reload forgets it and costs exactly one extra visit, which
  // is a cheaper failure than persisting a cost guard across a boundary where
  // it has no meaning — a card whose row looked identical before a restart is
  // still identical after, and the restart itself is not evidence that a visit
  // would find something new. It lives in the command's closure, not at module
  // scope, so two hosts (or two tests) never share a memory of one card.
  //
  // Kept here rather than in `lib/wake-gate.mjs` because the decision stays
  // pure: the module is told "this exact state was already visited" and does not
  // own a clock, a map, or the lifetime of either.
  const visited = new Map<string, string>();
  return async (argv, ctx) => {
    if (argv[0] !== "wake") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, { usage: USAGE });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    return verdictFor(deps, card, json, visited);
  };
}

function verdictFor(
  deps: CliDeps,
  card: WorkerCard,
  json: boolean,
  visited: Map<string, string>,
): CliResult {
  const print = wakeFingerprint({
    status: card.status,
    activity: card.activity,
    stage: card.stage,
    lastError: card.last_error,
  });
  const { wake, reason } = shouldWake({
    status: card.status,
    activity: card.activity,
    stage: card.stage,
    lastError: card.last_error,
    lastIdleAt: card.last_idle_at,
    now: deps.now(),
    autoCount: card.auto_continue_count,
    // The latch, not the raw streak: the read channel writes
    // `read_miss_since` only once a card has missed enough reads to be worth
    // reporting, so its presence IS the "host is not answering" verdict and this
    // read does not need a second threshold to disagree with.
    readUnreachable: card.read_miss_since != null,
    unchangedSinceVisit: visited.get(card.id) === print,
  });
  // Recorded only on a wake: the memory means "a turn was already spent on this
  // exact state". A refusal spends nothing, so it must not claim one was spent —
  // the next tick would then skip a state nobody ever looked at.
  if (wake) visited.set(card.id, print);

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ wake, reason, cardId: card.id }, null, 2),
    };
  }
  // The host's silent-skip contract, and the only line this command prints for
  // a refusal. Kept to exactly this shape: the automations plugin parses the
  // last non-empty stdout line as JSON and requires `wakeAgent === false`.
  if (!wake) return { exitCode: 0, stdout: '{"wakeAgent": false}' };
  // A wake prints its reason, so the sentinel's run is recorded as a success
  // with an explanation instead of a silent skip with none.
  return { exitCode: 0, stdout: reason };
}
