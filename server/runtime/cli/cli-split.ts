import { join } from "node:path";
import { isArchivedCard } from "../../../lib/worker-action-policy.mjs";
import { parseWorkflowConfig } from "../../../lib/workflow-config.mjs";
import {
  SPLIT_PROPOSAL_TTL_MS,
  splitEligibility,
  splitOutcome,
  splitRemainder,
} from "../../../lib/split-proposal.mjs";
import { ERR_CARD_ARCHIVED, noCardInContext, scanCardId, unknownCard, type CliCommandFn, type CliResult } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";
import { text } from "../values.js";
import { cardAttachments } from "../card-files.js";

const USAGE = "Usage: bb stelow split [--card <card_id>]";

type SplitSlice = { title?: string; label?: string; desc?: string; description?: string };

type Proposal = {
  slices: string;
  selected: string | null;
  asked_at: number;
  consumed_at: number | null;
  created: string;
};

type CreatedChild = { slice: string; cardId: string };

/** Executes the human-approved split proposal. No content args by design
 * (lib/split-proposal): the host executes the recorded proposal from
 * `ask --tag split`. A worker-supplied slice list would be self-dealing —
 * creation is a host act behind a human gate, so the only input is which
 * card. */
export function createSplitCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "split") return null;
    const scanned = scanCardId(argv.slice(1), ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
      boolean: [],
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
    return runSplit(deps, card);
  };
}

async function runSplit(deps: CliDeps, card: WorkerCard): Promise<CliResult> {
  // Same single-source gate as the ask path: slug truth, one error copy.
  const gate = splitEligibility({
    kind: card.kind,
    stage: await deps.cardStageSlug(card),
  });
  if (!gate.ok) return { exitCode: 1, stderr: gate.error! };
  const approved = await readApproval(deps, card.id);
  if (approved.result) return approved.result;
  // A Build split needs the same codebase as its parent. An exploratory
  // workspace contains only Stelow state, so fanning out there creates cards
  // that can claim a refactor without ever seeing the repository. Refuse
  // before creating even one child; Research/Explore are the deliberate
  // tracks for personal, document-only work.
  if (card.workspace_kind === "exploratory")
    return {
      exitCode: 1,
      stderr:
        "Cannot split a Build workflow from an exploratory workspace: it has no code project or Git history. Turn the work into a BB project \
(or restart it in the intended project), then propose the split again.",
    };
  const slices = JSON.parse(approved.proposal.slices) as SplitSlice[];
  const outcome = splitOutcome(
    slices,
    JSON.parse(approved.proposal.selected ?? "[]") as string[],
  );
  if (outcome.action === "keep")
    return {
      exitCode: 1,
      stderr:
        "The user chose to keep one card — no split. Continue this workflow normally past triage.",
    };
  if (outcome.action === "refuse") return { exitCode: 1, stderr: outcome.reason };
  const parent = await readParentInheritance(deps, card);
  const created = await createChildren(
    deps,
    card,
    slices,
    outcome.approved,
    approved.proposal,
    parent,
  );
  return reportSplit(deps, card, slices, outcome.approved, created);
}

type Approval = {
  proposal: Proposal;
  result?: undefined;
} | { result: CliResult; proposal?: undefined };

/** The recorded proposal, read in the order refusals are decided: no
 * proposal, already consumed, already split, unanswered, stale. */
async function readApproval(deps: CliDeps, cardId: string): Promise<Approval> {
  const proposal = deps.db
    .prepare(
      "SELECT slices, selected, asked_at, consumed_at, created FROM split_proposals WHERE card_id = ?",
    )
    .get(cardId) as Proposal | undefined;
  if (!proposal) return { result: noProposalRefusal() };
  const existingChildren = deps.db
    .prepare("SELECT id FROM cards WHERE split_from = ?")
    .all(cardId) as Array<{ id: string }>;
  if (proposal.consumed_at)
    return { result: consumedRefusal() };
  if (existingChildren.length > 0)
    return { result: childrenExistRefusal(existingChildren.length) };
  if (!proposal.selected) return { result: unansweredRefusal() };
  if (Date.now() - proposal.asked_at > SPLIT_PROPOSAL_TTL_MS)
    return { result: staleRefusal() };
  return { proposal };
}

function noProposalRefusal(): CliResult {
  return {
    exitCode: 1,
    stderr:
      'No split proposal on this card. Open one first at triage: `bb stelow ask --tag split --multiple --question <text> --option <card> \
--desc <slice>...` plus exactly one `--option "Keep as one card"`.',
  };
}

function consumedRefusal(): CliResult {
  return {
    exitCode: 1,
    stderr:
      "This card already split — see its comments for the children. Splitting twice would duplicate them.",
  };
}

function childrenExistRefusal(count: number): CliResult {
  return {
    exitCode: 1,
    stderr: `This card already split into ${count} ${count === 1 ? "card" : "cards"} — see its comments. \
Splitting twice would duplicate them.`,
  };
}

function unansweredRefusal(): CliResult {
  return {
    exitCode: 1,
    stderr:
      "The split proposal is not answered yet. Wait for the card answer, then run split again.",
  };
}

function staleRefusal(): CliResult {
  return {
    exitCode: 1,
    stderr:
      "The split approval is older than 24h — re-ask at the current stage instead of executing a stale one.",
  };
}

type ParentInheritance = {
  stateAbs: string | null;
  appetite: string;
  reviewGates: string[];
};

/** Children inherit the parent's project and appetite — the user chose them
 * for this work and they must share its source workspace. The gate set
 * inherits too, not just the ladder label. */
async function readParentInheritance(
  deps: CliDeps,
  card: WorkerCard,
): Promise<ParentInheritance> {
  const parentStateDir = card.dir_hash
    ? await deps
        .cardWorkspace(card)
        .then((workspace) =>
          workspace?.path
            ? deps.workflowStateDir(workspace.path, card.id, card.dir_hash!)
            : null,
        )
        .catch(() => null)
    : null;
  const stateAbs = parentStateDir ? join(parentStateDir, "state.md") : null;
  if (!stateAbs) return { stateAbs, appetite: "Lean", reviewGates: [] };
  // Shared parser: the indented `config:` block with whole, untruncated
  // values (a bare `(\S+)` once degraded "Product Spec + …" to "Product" on
  // live children).
  const blob = await deps.bb.sdk.files
    .read({ path: stateAbs })
    .then((file) => file.content)
    .catch(() => null);
  if (typeof blob !== "string")
    return { stateAbs, appetite: "Lean", reviewGates: [] };
  const parsed = parseWorkflowConfig(blob);
  return {
    stateAbs,
    appetite: parsed.appetite,
    reviewGates: parsed.reviewGates,
  };
}

/** Retry after a partial failure skips slices already created (recorded below
 * before reporting), so a retry never duplicates a child. */
async function createChildren(
  deps: CliDeps,
  card: WorkerCard,
  slices: SplitSlice[],
  approved: SplitSlice[],
  proposal: Proposal,
  parent: ParentInheritance,
): Promise<{ created: CreatedChild[]; failure: string | null }> {
  const createdSoFar = JSON.parse(proposal.created || "[]") as CreatedChild[];
  const createdKeys = new Set(
    createdSoFar.map((entry) => entry.slice.trim().toLowerCase()),
  );
  const todo = approved.filter(
    (slice) => !createdKeys.has(text(slice.title).trim().toLowerCase()),
  );
  const created = [...createdSoFar];
  let failure: string | null = null;
  for (const slice of todo) {
    try {
      const spawned = await createChild(
        deps,
        card,
        slice,
        slices.length,
        approved.length,
        parent,
      );
      created.push({ slice: text(slice.title), cardId: spawned.cardId });
    } catch (error) {
      failure =
        error instanceof Error ? error.message : "Could not spawn a build card.";
      break;
    }
  }
  return { created, failure };
}

async function createChild(
  deps: CliDeps,
  card: WorkerCard,
  slice: SplitSlice,
  sliceCount: number,
  approvedCount: number,
  parent: ParentInheritance,
): Promise<{ cardId: string }> {
  const title = text(slice.title);
  const desc = text(slice.desc);
  const spawned = await deps.createCard({
    projectId: card.project_id,
    prompt: `${title}\n\nSplit from "${card.display_name ?? card.name}" (triage proposed ${sliceCount}, approved ${approvedCount}). \
This card owns ONLY this slice — ignore everything else from the parent request:\n${desc}\n\nParent triage context: ${parent.stateAbs ?? "unavailable"} \
— read its triage notes, nothing else. Classify intent first, then work it through the normal build workflow.`,
    attachments: cardAttachments(card.attachments).map((attachment) => ({
      type: attachment.type,
      path: attachment.path,
    })),
    intent: "unknown",
    appetite: parent.appetite,
    reviewMode: parent.reviewGates,
    kind: "build",
  });
  deps.db
    .prepare("UPDATE cards SET split_from = ? WHERE id = ?")
    .run(card.id, spawned.cardId);
  deps.logCardComment(
    spawned.cardId,
    "card",
    spawned.cardId,
    "agent",
    `Split from "${card.display_name ?? card.name}" (${card.id}): this card owns "${title}".`,
  );
  return spawned;
}

async function reportSplit(
  deps: CliDeps,
  card: WorkerCard,
  slices: SplitSlice[],
  approved: SplitSlice[],
  outcome: { created: CreatedChild[]; failure: string | null },
): Promise<CliResult> {
  const { created, failure } = outcome;
  // Persist exactly the successfully spawned children before reporting a
  // partial failure, so retrying skips them instead of duplicating.
  deps.db
    .prepare("UPDATE split_proposals SET created = ? WHERE card_id = ?")
    .run(JSON.stringify(created), card.id);
  if (created.length > 0) {
    deps.logCardComment(
      card.id,
      "card",
      card.id,
      "agent",
      `Split into ${created.length} ${created.length === 1 ? "build card" : "build cards"}: ${created.map((entry) => entry.slice).join("; ")}.`,
    );
  }
  deps.bb.realtime.publish("card-state", { cardId: card.id });
  deps.bb.realtime.publish("board-changed", { cardId: card.id });
  if (failure) {
    const prefix =
      created.length > 0
        ? `Created ${created.length} ${created.length === 1 ? "build card" : "build cards"} before the remaining slices could not be created. `
        : "";
    return {
      exitCode: 1,
      stdout: `${prefix}Run split again to retry the rest.`,
      stderr: `${prefix}${failure}`,
    };
  }
  // Full approval consumes the proposal; a remainder keeps the parent alive
  // narrowed to it, otherwise the parent's whole content moved and it archives
  // with the trail above.
  deps.db
    .prepare("UPDATE split_proposals SET consumed_at = ? WHERE card_id = ?")
    .run(Date.now(), card.id);
  const { remaining, archiveParent } = splitRemainder(slices, approved);
  if (archiveParent) {
    // Full split parks the parent just like an Archive button or a drag to
    // Archived. The command's stdout is guidance, not a lifecycle guarantee:
    // end its worker here so it cannot consume a turn after its card has
    // disappeared from active work.
    await deps.workers.stop(card.worker_thread_id);
    deps.updateCard(card.id, { status: "archived", activity: "idle" });
    return {
      exitCode: 0,
      stdout: `${splitStdout(created)} \
The parent card is archived — stop: your workflow ends here.`,
    };
  }
  return {
    exitCode: 0,
    stdout: `${splitStdout(created)} \
The parent keeps the remainder (${remaining.map((slice) => text(slice.title)).join("; ")}) — continue it narrowed to that.`,
  };
}

function splitStdout(created: CreatedChild[]): string {
  return `Split into ${created.length} build ${created.length === 1 ? "card" : "cards"}: ${created.map((entry) => entry.slice).join("; ")}.`;
}
