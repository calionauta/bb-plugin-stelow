import { join } from "node:path";
import { buildChallenge, buildDecisionReceipt } from "../../../lib/decision-receipts.mjs";
import { requiresChallenge } from "../../../lib/decision-challenge.mjs";
import { resolveLive } from "../../../lib/decision-lineage.mjs";
import { readShapeVersion } from "../../../lib/scope-map-freshness.mjs";
import {
  loadDecisions,
  markSuperseded,
  saveChallenge,
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
  + " [--scopes s1,s2] [--reason <text>] [--by <name>] [--supersedes r-old] [--challenge ch-id] [--card <id>]"
  + " | bb stelow decide --open-challenge --against <receipt> --reason <text> [--card <id>]";

/** Record one decided selection on the host. The worker proposes; the host mints.
 *
 * The gate fires at write time and honors names, not claims: reviving a
 * rejected option or overturning a live pick requires `--challenge` naming a
 * challenge the registry actually holds against that receipt. A refusal names
 * the exact verbs to run — first open the challenge, then re-run decide.
 * Every write leaves a trail comment naming the outcome and its evidence.
 */
export function createDecideCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "decide") return null;
    const scanned = scanCardId(argv.slice(1), ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
      boolean: ["--json", "--open-challenge"],
      valued: ["--card", "--selected", "--rejected", "--scopes", "--reason", "--by", "--supersedes", "--challenge", "--against"],
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
    const flags = scanned.flags as Record<string, string>;
    if (flags["open-challenge"]) return openChallenge(deps, card, flags);
    return runDecide(deps, card, flags);
  };
}

type StateRef = { rootPath: string; stateDir: string };

async function resolveState(deps: CliDeps, card: WorkerCard): Promise<StateRef | { error: string }> {
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path) return { error: "The card workspace is unavailable." };
  const stateDir = card.dir_hash
    ? await deps.workflowStateDir(workspace.path, card.id, card.dir_hash).catch(() => null)
    : null;
  if (!stateDir) return { error: "Workflow state ownership cannot be verified for this card." };
  return { rootPath: workspace.path, stateDir };
}

async function openChallenge(deps: CliDeps, card: WorkerCard, flags: Record<string, string>): Promise<CliResult> {
  const against = (flags.against ?? "").trim();
  const reason = (flags.reason ?? "").trim();
  if (!against || !reason) return { exitCode: 1, stderr: `${USAGE}\n--open-challenge needs --against <receipt> and --reason <text>.` };
  const state = await resolveState(deps, card);
  if ("error" in state) return { exitCode: 1, stderr: state.error };
  const stored = await loadDecisions(deps.bb.sdk.files, state.stateDir);
  if (stored.corrupt) return { exitCode: 1, stderr: "The decision store is present but unreadable; refusing." };
  const target = stored.receipts.find((entry) => entry.id === against);
  if (!target) return { exitCode: 1, stderr: `No decision receipt ${against} on this card.` };
  if (typeof target.supersededBy === "string" && target.supersededBy) {
    return { exitCode: 1, stderr: `Receipt ${against} is already superseded; contest the live one instead.` };
  }
  const built = buildChallenge(
    { receiptId: against, reason, openedBy: byName(flags) },
    { id: deps.randomId("chg") },
  );
  if (!built.ok) return { exitCode: 1, stderr: built.reason };
  const saved = await saveChallenge(deps.bb.sdk.files, state.rootPath, state.stateDir, built.challenge);
  if (!saved.ok) return { exitCode: 1, stderr: saved.error };
  trail(deps, card.id, `Challenge ${built.challenge.id} opened against ${against}: ${reason}`);
  return { exitCode: 0, stdout: `Challenge recorded: ${built.challenge.id} contests ${against}.\n` };
}

type DecideFlags = {
  selected?: string;
  rejected?: string;
  scopes?: string;
  reason?: string;
  by?: string;
  supersedes?: string;
  challenge?: string;
};

async function runDecide(deps: CliDeps, card: WorkerCard, flags: DecideFlags): Promise<CliResult> {
  if (!flags.selected) return { exitCode: 1, stderr: `${USAGE}\n--selected names the winning option.` };
  const state = await resolveState(deps, card);
  if ("error" in state) return { exitCode: 1, stderr: state.error };
  const stored = await loadDecisions(deps.bb.sdk.files, state.stateDir);
  if (stored.corrupt) return { exitCode: 1, stderr: "The decision store is present but unreadable; refusing." };
  const shapeVersion = await readCardShapeVersion(deps, state.stateDir);
  const { live } = resolveLive(stored.receipts);
  const receiptId = deps.randomId("dec");
  const built = buildDecisionReceipt(
    {
      selectedId: flags.selected,
      rejectedOptionIds: flags.rejected,
      scopeIds: flags.scopes,
      reason: flags.reason,
      supersedes: flags.supersedes,
      challengeId: flags.challenge,
      approvedBy: byName(flags),
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
    const registered = hitReceiptChallenge(stored.challenges, flags.challenge, hit.receiptId);
    if (!registered) {
      return {
        exitCode: 1,
        stderr: `Refused: this ${hit.reason} under live receipt ${hit.receiptId}. `
          + `Open a challenge first: bb stelow decide --open-challenge --against ${hit.receiptId} --reason <why>, `
          + `then re-run with --challenge <challenge-id>.`,
      };
    }
  }
  const saved = await saveDecisionReceipt(deps.bb.sdk.files, state.rootPath, state.stateDir, built.receipt).catch(
    (error) => ({ ok: false as const, error: error instanceof Error ? error.message : "Unable to write the receipt." }),
  );
  if (!saved.ok) return { exitCode: 1, stderr: saved.error };
  const supersedes = asList(flags.supersedes);
  if (supersedes.length > 0) {
    await markSuperseded(deps.bb.sdk.files, state.rootPath, state.stateDir, supersedes, receiptId).catch(() => undefined);
  }
  trail(deps, card.id, decisionTrail(built.receipt));
  const conflictNote = await conflictTrail(deps, card.id, state, receiptId);
  return { exitCode: 0, stdout: `Decision recorded: ${receiptId} selects ${built.receipt.selectedId}.\n${conflictNote}` };
}

/**
 * A fresh contradiction between two live receipts is a fact the next agent
 * would otherwise pick through at random. It surfaces where the decision
 * lives — a trail comment plus the command's own stdout — never as a new
 * inbox kind the contract does not declare.
 */
async function conflictTrail(deps: CliDeps, cardId: string, state: StateRef, receiptId: string): Promise<string> {
  try {
    const stored = await loadDecisions(deps.bb.sdk.files, state.stateDir);
    const { conflicts } = resolveLive(stored.receipts);
    const mine = conflicts.filter((entry) => entry.a === receiptId || entry.b === receiptId);
    if (mine.length === 0) return "";
    const lines = mine.map((entry) => `${entry.a} vs ${entry.b} (${entry.scopeIds.join(", ") || "shared scopes"})`);
    trail(deps, cardId, `Decision conflict: ${lines.join("; ")}. Resolve by superseding one side.`);
    return `Warning: this contradicts live decision(s): ${lines.join("; ")}.\n`;
  } catch {
    return "";
  }
}

/** A claimed challenge counts only when the registry holds it against that receipt. */
function hitReceiptChallenge(
  challenges: Array<{ id: string; receiptId: string }>,
  claimed: string | undefined,
  receiptId: string,
): boolean {
  if (!claimed) return false;
  return challenges.some((entry) => entry.id === claimed && entry.receiptId === receiptId);
}

function byName(flags: { by?: string }): string {
  const name = typeof flags.by === "string" ? flags.by.trim() : "";
  return name || OPERATOR_IDENTITY;
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

function decisionTrail(receipt: Record<string, unknown>): string {
  const losers = Array.isArray(receipt.rejectedOptionIds) && receipt.rejectedOptionIds.length > 0
    ? ` Losers: ${receipt.rejectedOptionIds.join(", ")}.`
    : "";
  return `Decision ${receipt.id} recorded: selects ${receipt.selectedId}.${losers} Receipt: ${receipt.id} (by ${receipt.approvedBy}).`;
}

function trail(deps: CliDeps, cardId: string, body: string): void {
  try {
    deps.logCardComment(cardId, "card", cardId, "user", body);
  } catch {
    /* the record stands without its comment; the write already succeeded */
  }
}
