import { join } from "node:path";
import { buildDecisionReceipt } from "../../../lib/decision-receipts.mjs";
import { requiresChallenge } from "../../../lib/decision-challenge.mjs";
import { resolveLive } from "../../../lib/decision-lineage.mjs";
import { readShapeVersion } from "../../../lib/scope-map-freshness.mjs";
import {
  loadDecisionReceipts,
  markSuperseded,
  saveDecisionReceipt,
} from "../decision-store.js";
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
import { OPERATOR_IDENTITY } from "../../scope-map-approval.js";

const USAGE = "Usage: bb stelow decide --selected <option> [--rejected a,b]"
  + " [--scopes s1,s2] [--reason <text>] [--supersedes r-old] [--challenge r-live] [--card <id>]";

/** Record one decided selection on the host. The worker proposes; the host mints.
 *
 * The gate lives here, at write time: proposing what a live receipt rejected
 * refuses unless `--challenge` names that receipt. A refusal names the exact
 * flag to re-run with — a refusal without an exit is a deadlock with a good
 * error message. The write leaves a trail comment naming the receipt, the
 * winner, and the losers, never a bare stdout.
 */
export function createDecideCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "decide") return null;
    const scanned = scanCardId(argv.slice(1), ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
      boolean: ["--json"],
      valued: ["--card", "--selected", "--rejected", "--scopes", "--reason", "--supersedes", "--challenge"],
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
    return runDecide(deps, card, scanned.flags as Record<string, string>);
  };
}

type DecideFlags = {
  selected?: string;
  rejected?: string;
  scopes?: string;
  reason?: string;
  supersedes?: string;
  challenge?: string;
};

async function runDecide(deps: CliDeps, card: WorkerCard, flags: DecideFlags): Promise<CliResult> {
  if (!flags.selected) return { exitCode: 1, stderr: `${USAGE}\n--selected names the winning option.` };
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path) return { exitCode: 1, stderr: "The card workspace is unavailable." };
  const stateDir = card.dir_hash
    ? await deps.workflowStateDir(workspace.path, card.id, card.dir_hash).catch(() => null)
    : null;
  if (!stateDir) return { exitCode: 1, stderr: "Workflow state ownership cannot be verified for this card." };
  const shapeVersion = await readCardShapeVersion(deps, stateDir);
  const stored = await loadDecisionReceipts(deps.bb.sdk.files, stateDir);
  const { live } = resolveLive(stored);
  const receiptId = deps.randomId("dec");
  const built = buildDecisionReceipt(
    {
      selectedId: flags.selected,
      rejectedOptionIds: flags.rejected,
      scopeIds: flags.scopes,
      reason: flags.reason,
      supersedes: flags.supersedes,
      challengeId: flags.challenge,
      approvedBy: OPERATOR_IDENTITY,
    },
    { id: receiptId, shapeVersion: shapeVersion ?? undefined },
  );
  if (!built.ok) return { exitCode: 1, stderr: built.reason };
  const hit = requiresChallenge(
    { scopeIds: built.receipt.scopeIds, optionIds: [built.receipt.selectedId], selectedId: built.receipt.selectedId },
    live.filter((entry) => entry.id !== receiptId),
    { challengeReceiptIds: flags.challenge ? [flags.challenge] : [] },
  );
  if (hit) {
    return {
      exitCode: 1,
      stderr: `Refused: this ${hit.reason} under live receipt ${hit.receiptId}. `
        + `Open a challenge naming it and re-run with --challenge ${hit.receiptId}.`,
    };
  }
  const saved = await saveDecisionReceipt(deps.bb.sdk.files, workspace.path, stateDir, built.receipt).catch(
    (error) => ({ ok: false as const, error: error instanceof Error ? error.message : "Unable to write the receipt." }),
  );
  if (!saved.ok) return { exitCode: 1, stderr: saved.error };
  const supersedes = asList(flags.supersedes);
  if (supersedes.length > 0) {
    await markSuperseded(deps.bb.sdk.files, workspace.path, stateDir, supersedes, receiptId).catch(() => undefined);
  }
  trailComment(deps, card.id, built.receipt);
  return { exitCode: 0, stdout: `Decision recorded: ${receiptId} selects ${built.receipt.selectedId}.\n` };
}

function asList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

async function readCardShapeVersion(deps: CliDeps, stateDir: string): Promise<string | null> {
  try {
    const file = await deps.bb.sdk.files.read({ path: join(stateDir, "state.md") });
    return readShapeVersion(typeof file?.content === "string" ? file.content : "");
  } catch {
    return null;
  }
}

function trailComment(deps: CliDeps, cardId: string, receipt: Record<string, unknown>): void {
  const losers = Array.isArray(receipt.rejectedOptionIds) && receipt.rejectedOptionIds.length > 0
    ? ` Losers: ${receipt.rejectedOptionIds.join(", ")}.`
    : "";
  try {
    deps.logCardComment(
      cardId,
      "card",
      cardId,
      "user",
      `Decision ${receipt.id} recorded: selects ${receipt.selectedId}.${losers} Receipt: ${receipt.id} (by ${receipt.approvedBy}).`,
    );
  } catch {
    /* the receipt stands without its comment; the write already succeeded */
  }
}
