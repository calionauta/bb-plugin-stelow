import { summarizeDelegationEvidence } from "../../../lib/delegation-evidence.mjs";
import { countDelegations } from "../../../lib/delegation-evidence.mjs";
import {
  noCardInContext,
  scanCardId,
  unknownCard,
  type CliCommandFn,
  type CliResult,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";

const USAGE = "Usage: bb stelow verify-delegation [--card <card_id>] [--json]";

/** Advisory delegation tripwire: the host cannot see subagent freshness —
 * only whether any delegation happened at all. Counts structural delegation
 * items in the worker thread timeline; prose matches never count. Zero reads
 * as inconclusive ("may be self-review"), never as certain. Read-only, never a
 * gate. */
export function createVerifyDelegationCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "verify-delegation") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    return delegationEvidence(deps, card.id, card.worker_thread_id, json);
  };
}

async function delegationEvidence(
  deps: CliDeps,
  cardId: string,
  workerThreadId: string | null,
  json: boolean,
): Promise<CliResult> {
  if (!workerThreadId)
    return {
      exitCode: 0,
      stdout: "No worker thread — nothing to inspect for delegations.",
    };
  const timeline = await deps.bb.sdk.threads
    .timeline({ threadId: workerThreadId, segmentLimit: "100" })
    .catch(() => null);
  if (!timeline)
    return {
      exitCode: 1,
      stderr: "Could not read the worker thread timeline — retry later.",
    };
  // segmentLimit 100 covers realistic worker threads whole; pagination cursors
  // are not interpreted — a truncated giant thread would undercount, and the
  // summary discloses observation, not certainty.
  const delegations = countDelegations(timeline);
  const evidence = summarizeDelegationEvidence({
    delegations,
    truncated: false,
  });
  if (json)
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        { card: cardId, delegations, observed: evidence.observed },
        null,
        2,
      ),
    };
  return { exitCode: 0, stdout: evidence.summary };
}
