import { formatDuration, summarizeTimeline } from "../../../lib/card-metrics.mjs";
import { noCardInContext, scanCardId, unknownCard } from "./cli-contract.js";
import type { CliCommandFn, CliResult } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow metrics [--json] [--card <card_id>]";

// The fleet query returns full card rows; gap state reads the same fields as
// the card store does, so the row is used as-is (no second lookup).
type BuildCardRow = WorkerCard;

type FleetEntry = {
  card: string;
  name: string;
  done: boolean;
  gaps: number;
  escalated: number;
};

/** Lead/cycle-time and gap-rate readout from the stage-event ledger plus the
 * live gap registry. Read-only: never writes, never blocks. No --card means
 * the fleet: every non-archived Build card aggregated. */
export function createMetricsCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "metrics") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, { usage: USAGE });
    if (scanned.result) return scanned.result;
    const cardId = scanned.cardId;
    // No --card and no thread card: the fleet readout, not a refusal.
    if (!cardId && !args.includes("--card")) return fleetMetrics(deps, json);
    if (!cardId) return noCardInContext();
    const card = deps.getCard(cardId);
    if (!card) return unknownCard(cardId);
    return cardMetrics(deps, card, json);
  };
}

async function fleetMetrics(deps: CliDeps, json: boolean): Promise<CliResult> {
  const rows = deps.db
    .prepare("SELECT * FROM cards WHERE kind = 'build' AND status != 'archived'")
    .all() as BuildCardRow[];
  if (rows.length === 0)
    return { exitCode: 0, stdout: "No Build cards to aggregate." };
  const totals: FleetTotals = {
    gaps: 0,
    escalated: 0,
    leadSum: 0,
    leadCount: 0,
    cycleSum: 0,
    cycleCount: 0,
    done: 0,
  };
  const perCard: FleetEntry[] = [];
  for (const row of rows) {
    const entry = await fleetCardEntry(deps, row, totals);
    // One unreadable card never breaks the fleet readout.
    if (entry) perCard.push(entry);
  }
  return renderFleet(json, rows.length, totals, perCard);
}

type FleetTotals = {
  gaps: number;
  escalated: number;
  leadSum: number;
  leadCount: number;
  cycleSum: number;
  cycleCount: number;
  done: number;
};

/** Folds one card's timeline and gap registry into the fleet totals, and
 * returns its own row for the per-card list. */
async function fleetCardEntry(
  deps: CliDeps,
  row: BuildCardRow,
  totals: FleetTotals,
): Promise<FleetEntry | null> {
  try {
    const events = deps.stageEvents(row.id);
    const doneEvent =
      [...events].reverse().find((event) => event.stage === "done") ?? null;
    const timeline = summarizeTimeline(events, {
      createdAt: row.created_at,
      endAt: doneEvent ? doneEvent.entered_at : deps.now(),
    });
    totals.leadSum += timeline.leadMs;
    totals.leadCount++;
    if (timeline.cycleMs !== null) {
      totals.cycleSum += timeline.cycleMs;
      totals.cycleCount++;
    }
    if (row.status === "completed") totals.done++;
    const gapState = await deps.gapState(row).catch(() => null);
    const gaps = gapState?.matched ? gapState.totals.total : 0;
    const escalated = gapState?.matched ? gapState.totals.escalated : 0;
    totals.gaps += gaps;
    totals.escalated += escalated;
    return {
      card: row.id,
      name: row.name,
      done: row.status === "completed",
      gaps,
      escalated,
    };
  } catch {
    return null;
  }
}

function renderFleet(
  json: boolean,
  cards: number,
  totals: FleetTotals,
  perCard: FleetEntry[],
): CliResult {
  const { done, gaps, escalated } = totals;
  const payload = {
    cards,
    done,
    avgLeadMs:
      totals.leadCount > 0 ? Math.round(totals.leadSum / totals.leadCount) : null,
    avgCycleMs:
      totals.cycleCount > 0
        ? Math.round(totals.cycleSum / totals.cycleCount)
        : null,
    gaps,
    escalated,
    escalatedRate: gaps > 0 ? escalated / gaps : null,
    perCard,
  };
  if (json)
    return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
  const rate =
    payload.escalatedRate === null
      ? "n/a"
      : `${Math.round(payload.escalatedRate * 100)}%`;
  const lines = [
    `Fleet: ${cards} Build cards (${done} done)`,
    `Avg lead time: ${
      payload.avgLeadMs === null ? "n/a" : formatDuration(payload.avgLeadMs)
    } · avg cycle time: ${
      payload.avgCycleMs === null ? "n/a" : formatDuration(payload.avgCycleMs)
    }`,
    `Gaps: ${gaps} total · ${escalated} escalated (${rate} escalated)`,
    ...perCard.map(
      (entry) =>
        `- ${entry.name}: ${entry.gaps} gaps · ${entry.escalated} escalated${entry.done ? " · done" : ""}`,
    ),
  ];
  return { exitCode: 0, stdout: lines.join("\n") };
}

async function cardMetrics(
  deps: CliDeps,
  card: WorkerCard,
  json: boolean,
): Promise<CliResult> {
  const cardId = card.id;
  const events = deps.stageEvents(cardId);
  const doneEvent =
    [...events].reverse().find((event) => event.stage === "done") ?? null;
  const endAt = doneEvent ? doneEvent.entered_at : deps.now();
  const timeline = summarizeTimeline(events, {
    createdAt: card.created_at,
    endAt,
  });
  const gapState =
    card.kind === "build" ? await deps.gapState(card).catch(() => null) : null;
  const totals = gapState?.matched
    ? gapState.totals
    : { total: 0, fixed: 0, documented: 0, escalated: 0 };
  const payload = {
    card: cardId,
    name: card.name,
    done: card.status === "completed",
    leadMs: timeline.leadMs,
    cycleMs: timeline.cycleMs,
    byStage: timeline.byStage,
    gaps: totals,
    escalatedRate: totals.total > 0 ? totals.escalated / totals.total : null,
    reworkScopes: gapState?.matched
      ? gapState.auditGapScopes.map((scope) => ({
          id: scope.id,
          name: scope.name,
          status: scope.status,
        }))
      : [],
  };
  if (json)
    return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
  const lines = [
    `Card ${card.name} (${cardId})${payload.done ? " — done" : ""}`,
    `Lead time: ${formatDuration(timeline.leadMs)} (created → ${doneEvent ? "done" : "now"})`,
    cycleLine(timeline.cycleMs, doneEvent !== null),
    ...stageLines(timeline.byStage),
  ];
  if (gapState?.matched) lines.push(...gapLines(totals, payload));
  return { exitCode: 0, stdout: lines.join("\n") };
}

type CardTimeline = ReturnType<typeof summarizeTimeline>;

function stageLines(byStage: CardTimeline["byStage"]): string[] {
  if (byStage.length === 0) return [];
  return [
    "Stages:",
    ...byStage.map((entry) => `- ${entry.stage}: ${formatDuration(entry.ms)}`),
  ];
}

function gapLines(
  totals: { total: number; fixed: number; documented: number; escalated: number },
  payload: { escalatedRate: number | null; reworkScopes: Array<{ id: string; status: string }> },
): string[] {
  const rate =
    payload.escalatedRate === null
      ? "n/a"
      : `${Math.round(payload.escalatedRate * 100)}%`;
  return [
    `Gaps: ${totals.total} total · ${totals.fixed} fixed · ${totals.documented} documented · ${totals.escalated} escalated (${rate} escalated)`,
    reworkScopeLine(payload.reworkScopes),
  ];
}

function cycleLine(cycleMs: number | null, done: boolean): string {
  if (cycleMs === null) return "Cycle time: not started (never left triage)";
  return `Cycle time: ${formatDuration(cycleMs)} (first advance → ${done ? "done" : "now"})`;
}

function reworkScopeLine(
  scopes: Array<{ id: string; status: string }>,
): string {
  return scopes.length > 0
    ? `Rework scopes: ${scopes.map((scope) => `${scope.id} (${scope.status})`).join(", ")}`
    : "Rework scopes: none";
}
