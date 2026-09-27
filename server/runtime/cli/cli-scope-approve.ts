import {
  ERR_CARD_ARCHIVED,
  noCardInContext,
  scanCardId,
  unknownCard,
  type CliCommandFn,
  type CliResult,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";
import { isArchivedCard } from "../../../lib/worker-action-policy.mjs";

const USAGE = "Usage: bb stelow scope-approve [--card <card_id>]";

/** Approve a card's scope map on the host (no content args).
 *
 * Content-free by design, like `split`: the approver is whoever runs the verb,
 * so the only input is which card. The host mints the receipt, stamps the map,
 * mirrors the Shape version into state.md, and records a trail comment naming
 * the outcome and its evidence. Advancing past the scope stage never approves on
 * the human's behalf — a refactor's scopes are the thing being decided.
 */
export function createScopeApproveCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "scope-approve") return null;
    const scanned = scanCardId(argv.slice(1), ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
      boolean: ["--json"],
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
    return runScopeApprove(deps, card);
  };
}

async function runScopeApprove(deps: CliDeps, card: WorkerCard): Promise<CliResult> {
  const result = await deps.scopeMapApproval(card.id);
  if (!result.ok) return { exitCode: 1, stderr: result.error };
  const lines = [
    `Scope map approved: ${result.mapId}`,
    `Receipt: ${result.receiptId} (by ${result.approvedBy})`,
    `Shape version: ${result.shapeVersion} (mirrored into state.md)`,
    `Scopes: ${result.scopeIds.join(", ")}`,
    "The approved map is immutable for downstream planning.",
  ];
  return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
}
