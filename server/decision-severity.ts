/**
 * The inbox severity bump: advisory scoring for recent low-tier events.
 *
 * Bounded to three settled candidates per tick, never re-judging an item
 * already carrying a `model-judged` reason, and promotion-only — a score can
 * escalate severity, never resolve or demote anything. The whole sweep is
 * advisory: a thrown error leaves the deterministic tiers exactly as they
 * were.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  isDecisionApiDisabled,
  meetsDecisionThreshold,
} from "../lib/decision-api.mjs";
import {
  DECISION_POINT_INBOX_SEVERITY,
  normalizePointMode,
  severityBumpQuestions,
} from "../lib/decision-points.mjs";
import { parseSeverityReasons } from "../lib/inbox-severity.mjs";
import type { DecisionRoute } from "./decision-route.js";
import type { PointRow } from "./decision-store.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export interface DecisionSeverityDeps {
  db: Db;
  bb: BbPluginApi;
  route: DecisionRoute;
  now: () => number;
  pointRow: (point: string) => PointRow | undefined;
  parsedThresholds: (
    row: PointRow | undefined,
    point: string,
  ) => { routeAt: number };
  evaluateCall: typeof import("../lib/decision-api.mjs").evaluateDecisionCall;
}

interface SeverityCandidate {
  id: string;
  summary: string;
  severity_reasons: string | null;
  display_name: string | null;
  name: string;
  card_kind: string | null;
  stage: string;
}

/** Settled, unresolved, low-tier, and never already model-judged. */
function severityCandidates(ctx: DecisionSeverityDeps): SeverityCandidate[] {
  return ctx.db
    .prepare([
      "SELECT id, summary, severity_reasons, display_name, name, kind AS card_kind, stage",
      "FROM inbox_events JOIN cards ON cards.id = inbox_events.card_id",
      "WHERE resolved_at IS NULL AND archived_at IS NULL AND severity = 1",
      "AND occurred_at <= ? AND severity_reasons NOT LIKE '%model-judged%'",
      "ORDER BY occurred_at ASC LIMIT 3",
    ].join(" "))
    .all(ctx.now() - 5 * 60 * 1000) as SeverityCandidate[];
}

async function judgeSeverityRow(
  ctx: DecisionSeverityDeps,
  row: SeverityCandidate,
  point: PointRow | undefined,
  call: ReturnType<DecisionRoute["callRoute"]>,
): Promise<number> {
  const state = `Card "${row.display_name ?? row.name}" (${row.card_kind ?? "build"}, stage ${row.stage}): ${row.summary}`;
  const result = await ctx
    .evaluateCall({
      provider: call.provider,
      endpoint: call.endpoint,
      apiKey: call.apiKey,
      model: call.model,
      state,
      questions: severityBumpQuestions(),
    })
    .catch(() => null);
  const answer = result?.ok ? result.answers?.blocking : null;
  if (answer?.type !== "noul" || typeof answer.noul !== "number") return 0;
  const reasons = JSON.stringify([
    ...parseSeverityReasons(row.severity_reasons),
    "model-judged",
  ]);
  const sql = meetsDecisionThreshold(
    answer.noul,
    ctx.parsedThresholds(point, DECISION_POINT_INBOX_SEVERITY).routeAt,
  )
    ? "UPDATE inbox_events SET severity = 2, severity_reasons = ? WHERE id = ? AND resolved_at IS NULL"
    : "UPDATE inbox_events SET severity_reasons = ? WHERE id = ? AND resolved_at IS NULL";
  return ctx.db.prepare(sql).run(reasons, row.id).changes;
}

async function maybeBumpSeverity(ctx: DecisionSeverityDeps): Promise<void> {
  try {
    const point = ctx.pointRow(DECISION_POINT_INBOX_SEVERITY);
    const mode = normalizePointMode(point?.mode, "rules");
    if (mode === "preset") {
      ctx.bb.log.warn(
        "inbox severity ignores preset mode: hot paths stay on rules/api so judgments never burn worker turns.",
      );
    }
    if (mode !== "api" || isDecisionApiDisabled(process.env)) return;
    const call = ctx.route.callRoute(point);
    if (!call.usable) return;
    let changed = 0;
    for (const row of severityCandidates(ctx)) {
      changed += await judgeSeverityRow(ctx, row, point, call);
    }
    if (changed > 0) ctx.bb.realtime.publish("inbox-changed", { bumped: changed });
  } catch {
    /* advisory only — tiers stand without the bump */
  }
}

export function createSeverityBump(ctx: DecisionSeverityDeps) {
  return { maybeBumpSeverity: () => maybeBumpSeverity(ctx) };
}
