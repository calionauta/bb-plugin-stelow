import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isArchivedCard } from "../../../lib/worker-action-policy.mjs";
import { recordTrackableEvent } from "../../../lib/trackable-events.mjs";
import { workflowEntryForOwner } from "../../../lib/workflow-state-identity.mjs";
import { array, record, type LooseRecord } from "../values.js";
import {
  ERR_CARD_ARCHIVED,
  noCardInContext,
  unknownCard,
  usage,
  type CliCommandFn,
  type CliResult,
  type CliRunContext,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow gap-scopes [--card <card_id>]";

/** The critique-gap view gap-scopes converts: the escalated rows, the scopes
 * already linked to them, and the fixed/documented/escalated tally it reports. */
type CritiqueGapView = {
  totals: { total: number; fixed: number; documented: number; escalated: number };
  escalated: Array<{ description: string }>;
  auditGapScopes: Array<{ gap: string | null }>;
};

export function createGapScopesCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) =>
    argv[0] === "gap-scopes" ? runGapScopes(deps, argv, ctx) : null;
}

/** Deterministic ESCALATED → scopes conversion (upstream criteria 9). The
 * worker classifies gaps; code creates the rework scopes so the loop cannot
 * be skipped by prose. Idempotent: gaps already linked to an audit-gap scope
 * are skipped. Refuses on registry failures — creating scopes from
 * misclassified rows would launder them. */
async function runGapScopes(
  deps: CliDeps,
  argv: string[],
  ctx: CliRunContext,
): Promise<CliResult> {
  const cardId = gapScopesCardId(deps, argv, ctx);
  if (typeof cardId !== "string") return cardId;
  const card = deps.getCard(cardId);
  if (!card) return unknownCard(cardId);
  if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
  if (card.kind !== "build")
    return {
      exitCode: 1,
      stderr:
        "gap-scopes runs on Build cards — research and explore have no scopes.",
    };
  const gapState = await deps.gapState(card).catch(() => null);
  if (!gapState?.matched)
    return {
      exitCode: 1,
      stderr: "No execution critique found — write it first, then run gap-scopes.",
    };
  if (gapState.failures.length > 0)
    return { exitCode: 1, stderr: gapState.failures.join("\n") };
  if (gapState.escalated.length === 0)
    return { exitCode: 0, stdout: "No escalated gaps — nothing to convert." };
  const tracking = await gapScopesTracking(deps, card, cardId);
  if ("result" in tracking) return tracking.result;
  const created = createReworkScopes(tracking.entry, gapState);
  if (created.length === 0)
    return {
      exitCode: 0,
      stdout:
        "Every escalated gap already links a rework scope — nothing to convert.",
    };
  return reportGapScopes(
    deps,
    cardId,
    tracking.path,
    tracking.data,
    gapState,
    created,
  );
}

function gapScopesCardId(
  deps: CliDeps,
  argv: string[],
  ctx: CliRunContext,
): string | CliResult {
  const args = argv.slice(1);
  let cardId = ctx.threadId
    ? deps.getCardByWorkerThread(ctx.threadId)?.id
    : undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--card") {
      cardId = args[index + 1];
      index++;
      continue;
    }
    return usage(USAGE);
  }
  if (!cardId) return noCardInContext();
  return cardId;
}

type WorkflowEntry = LooseRecord;

async function gapScopesTracking(
  deps: CliDeps,
  card: WorkerCard,
  cardId: string,
): Promise<
  { path: string; data: LooseRecord; entry: WorkflowEntry } | { result: CliResult }
> {
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  const rootPath = workspace?.path ?? null;
  if (!rootPath)
    return { result: { exitCode: 1, stderr: "Workspace path is unavailable." } };
  const path = join(rootPath, "stelow.json");
  let data: LooseRecord;
  try {
    data = JSON.parse(readFileSync(path, "utf8")) as LooseRecord;
  } catch {
    return {
      result: {
        exitCode: 1,
        stderr:
          "stelow.json is missing for the Stelow workflow. Reseed the workflow.",
      },
    };
  }
  const entry = workflowEntryForOwner(array(data.workflows), cardId) as
    | WorkflowEntry
    | null;
  if (!entry)
    return {
      result: {
        exitCode: 1,
        stderr: "No workflow entry owns this card. Reseed the workflow.",
      },
    };
  return { path, data, entry };
}

/** Appends one rework scope per unlinked escalated gap, numbering after the
 * highest existing `scope-N`. Returns the created `scope-N: description`
 * lines. */
function createReworkScopes(
  entry: WorkflowEntry,
  gapState: CritiqueGapView,
): string[] {
  const scopes = array(entry.scopes);
  const linked = new Set(
    gapState.auditGapScopes
      .map((scope) => scope.gap)
      .filter((gap): gap is string => typeof gap === "string"),
  );
  let maxId = 0;
  for (const scope of scopes) {
    const num = parseInt(
      String(record(scope).id ?? "").replace("scope-", ""),
      10,
    );
    if (Number.isFinite(num) && num > maxId) maxId = num;
  }
  const created: string[] = [];
  for (const gap of gapState.escalated) {
    if (linked.has(gap.description)) continue;
    maxId++;
    scopes.push({
      id: `scope-${maxId}`,
      name: gap.description.slice(0, 80),
      type: "feature",
      status: "pending",
      source: "audit-gap",
      gap: gap.description,
      tasks: [],
    });
    created.push(`scope-${maxId}: ${gap.description.slice(0, 80)}`);
  }
  entry.scopes = scopes;
  entry.updated = new Date().toISOString();
  return created;
}

function reportGapScopes(
  deps: CliDeps,
  cardId: string,
  trackingPath: string,
  trackingData: LooseRecord,
  gapState: CritiqueGapView,
  created: string[],
): CliResult {
  try {
    writeFileSync(trackingPath, JSON.stringify(trackingData, null, 2), "utf8");
  } catch {
    return {
      exitCode: 1,
      stderr: "Could not write stelow.json — retry gap-scopes.",
    };
  }
  try {
    recordTrackableEvent(deps.db, {
      cardId,
      kind: "scope",
      trackableId: "audit-gap",
      transition: "rework-created",
      actor: "host",
      evidence: `${created.length} rework scope(s): ${created
        .map((line) => line.split(":")[0])
        .join(", ")}`,
    });
  } catch {
    /* trail never blocks */
  }
  // Rework scopes appear on the card immediately, not at the next lifecycle
  // event.
  deps.bb.realtime.publish("card-state", { cardId });
  deps.bb.realtime.publish("board-changed", { cardId });
  deps.logCardComment(
    cardId,
    "card",
    cardId,
    "agent",
    gapDecisionComment(gapState, created),
  );
  return { exitCode: 0, stdout: gapDecisionStdout(gapState, created) };
}

function gapDecisionComment(gapState: CritiqueGapView, created: string[]): string {
  return `Gap-to-scope decision: ${gapState.totals.fixed} fixed inline, ${
    gapState.totals.documented
  } documented for next cycle, ${gapState.escalated.length} escalated — ${
    created.length
  } new rework scope(s):\n${created.map((line) => `- ${line}`).join("\n")}\nThe card loops back: advance \
to execution, execute the rework scopes, re-run the critique, then run done again.`;
}

function gapDecisionStdout(gapState: CritiqueGapView, created: string[]): string {
  return `Decision recorded: ${gapState.totals.fixed} fixed, ${
    gapState.totals.documented
  } documented, ${gapState.escalated.length} escalated.\nCreated ${
    created.length
  } rework scope(s):\n${created.map((line) => `- ${line}`).join("\n")}\nLoop back now: bb stelow advance execution \
— execute the new scopes, re-run the critique, then run done again.`;
}
