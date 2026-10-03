import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OWNERSHIP_UNVERIFIED } from "../../../lib/ownership-refusal.mjs";
import {
  MAX_REWORK_ROUNDS,
  nextReworkRounds,
  reworkCapReached,
  reworkCapRefusal,
  reworkRoundsOf,
} from "../../../lib/rework-rounds.mjs";
import { hasGapEvidence } from "../../../lib/gap-evidence.mjs";
import type { GapEvidence } from "../../../lib/gap-evidence.mjs";
import { riskReading } from "../../../lib/risk-reading.mjs";
import { summarizeRework } from "../../../lib/rework-metrics.mjs";
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
import type { GapTotals } from "../../../lib/metrics-format.mjs";

const USAGE = "Usage: bb stelow gap-scopes [--card <card_id>]";
import { CARD_WORKSPACE_UNAVAILABLE } from "../../../lib/workspace-refusal.mjs";

/** The critique-gap view gap-scopes converts: the escalated rows, the scopes
 * already linked to them, and the fixed/documented/escalated tally it reports.
 * The tally's shape belongs to lib/metrics-format.mjs, the same owner the
 * metrics readout and the card header read it from. */
type CritiqueGapView = {
  totals: GapTotals;
  escalated: Array<{ description: string; evidence?: GapEvidence | null; impact?: string | null }>;
  auditGapScopes: Array<{ gap: string | null }>;
  /** Present when the card has matched critiques; absent in older harnesses. */
  critiqueRounds?: Array<Array<{ description: string; resolution: string }>>;
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
  return convertEscalated(deps, card, cardId, gapState);
}

/** Tracking I/O plus the round budget: capped cards refuse with three exits,
 * creating cards spend one round, idempotent re-runs spend nothing. */
async function convertEscalated(
  deps: CliDeps,
  card: WorkerCard,
  cardId: string,
  gapState: CritiqueGapView,
): Promise<CliResult> {
  const tracking = await gapScopesTracking(deps, card, cardId);
  if ("result" in tracking) return tracking.result;
  const unlinked = unlinkedEscalated(gapState);
  const rounds = reworkRoundsOf(tracking.entry);
  if (unlinked.length > 0 && reworkCapReached(tracking.entry))
    return refuseReworkCap(deps, cardId, gapState, rounds, unlinked);
  const created = createReworkScopes(tracking.entry, gapState);
  if (created.length > 0)
    tracking.entry.rework_rounds = nextReworkRounds(tracking.entry, created.length);
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
    reworkRoundsOf(tracking.entry),
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
    return { result: { exitCode: 1, stderr: CARD_WORKSPACE_UNAVAILABLE } };
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
  // A tracking file with no entry for this card is the ownership verdict, not a
  // variant of the missing-file refusal above, so it reads the shared sentence
  // rather than its own words: the worker reading this stderr cannot reseed
  // itself, and the door that does work is named in one place for every reader.
  if (!entry) return { result: { exitCode: 1, stderr: OWNERSHIP_UNVERIFIED } };
  return { path, data, entry };
}

/** Escalated gaps with no audit-gap scope linked yet — the rework loop input. */
function unlinkedEscalated(gapState: CritiqueGapView): string[] {
  const linked = new Set(
    gapState.auditGapScopes
      .map((scope) => scope.gap)
      .filter((gap): gap is string => typeof gap === "string"),
  );
  return gapState.escalated
    .map((gap) => gap.description)
    .filter((description) => !linked.has(description));
}

/** Honest stop at the round budget: no scopes are created or written, but the
 * stop is recorded where the card's history can point at it — a trail event,
 * a card comment, and realtime refresh, the same three surfaces a successful
 * conversion writes to. The stderr names the three exits that already exist,
 * so the card never parks without a door. An oscillating finding is named
 * alongside: re-running the disagreement is not one of the exits. */
function refuseReworkCap(
  deps: CliDeps,
  cardId: string,
  gapState: CritiqueGapView,
  rounds: number,
  unlinked: string[],
): CliResult {
  const oscillating = summarizeRework(gapState.critiqueRounds ?? []).oscillatingDescriptions;
  const lines = [reworkCapRefusal(rounds, unlinked)];
  if (oscillating.length > 0) {
    lines.push(`Oscillation: ${oscillating.join("; ")} came back after a fix across 3+ rounds — decides by human, not by another round.`);
  }
  const stderr = lines.join("\n");
  try {
    recordTrackableEvent(deps.db, {
      cardId,
      kind: "scope",
      trackableId: "audit-gap",
      transition: "rework-capped",
      actor: "host",
      evidence: `rework round budget reached (${rounds}/${MAX_REWORK_ROUNDS}); ${unlinked.length} unscoped escalated gap(s)`,
    });
  } catch {
    /* trail never blocks */
  }
  deps.bb.realtime.publish("card-state", { cardId });
  deps.bb.realtime.publish("board-changed", { cardId });
  deps.logCardComment(cardId, "card", cardId, "agent", `Gap-to-scope decision: ${stderr}`);
  return { exitCode: 1, stderr };
}

/** Appends one rework scope per unlinked escalated gap, numbering after the
 * highest existing `scope-N`. Returns the created `scope-N: description`
 * lines. The gap's evidence travels with the scope: the scope keeps only a
 * description string otherwise, so cited measurements would die at the
 * conversion — the worker executing the rework needs the callers, tests,
 * and check the critique cited. Same vocabulary scopes and tasks may carry
 * by convention; the risk reading is the shared function that reads it. */
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
    const evidence = gap.evidence ?? null;
    scopes.push({
      id: `scope-${maxId}`,
      name: gap.description.slice(0, 80),
      type: "feature",
      status: "pending",
      source: "audit-gap",
      gap: gap.description,
      impact: typeof gap.impact === "string" ? gap.impact : null,
      evidence,
      risk: riskReading({
        impact: gap.impact ?? null,
        callers: evidence?.callers ?? null,
        reversible: evidence?.reversible ?? null,
        check: evidence?.check ?? null,
      }),
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
  rounds: number,
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
      evidence: `rework round ${rounds}/${MAX_REWORK_ROUNDS}: ${created.length} rework scope(s): ${created
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
    gapDecisionComment(gapState, created, rounds),
  );
  return { exitCode: 0, stdout: gapDecisionStdout(gapState, created, rounds) };
}

function gapDecisionComment(gapState: CritiqueGapView, created: string[], rounds: number): string {
  const evidenced = evidencedCount(gapState);
  return `Gap-to-scope decision (rework round ${rounds}/${MAX_REWORK_ROUNDS}): ${gapState.totals.fixed} fixed inline, ${
    gapState.totals.documented
  } documented as accepted debt (no carry-forward — see card checks), ${
    gapState.escalated.length
  } escalated (${evidenced} cite measurements) — ${
    created.length
  } new rework scope(s):\n${created.map((line) => `- ${line}`).join("\n")}\nThe card loops back: advance \
to execution, execute the rework scopes, re-run the critique, then run done again.`;
}

function gapDecisionStdout(gapState: CritiqueGapView, created: string[], rounds: number): string {
  return `Decision recorded (rework round ${rounds}/${MAX_REWORK_ROUNDS}): ${gapState.totals.fixed} fixed, ${
    gapState.totals.documented
  } documented, ${gapState.escalated.length} escalated (${evidencedCount(gapState)} with evidence).\nCreated ${
    created.length
  } rework scope(s):\n${created.map((line) => `- ${line}`).join("\n")}\nLoop back now: bb stelow advance execution \
— execute the new scopes, re-run the critique, then run done again.`;
}

/** Escalated gaps whose row cites measurements. Unmeasured escalations are
 * fail-open (older registries, hosts without tools), so this is a count of
 * what is evidenced, never a gate. */
function evidencedCount(gapState: CritiqueGapView): number {
  return gapState.escalated.filter((gap) => hasGapEvidence(gap.evidence)).length;
}
