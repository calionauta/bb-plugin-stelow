/**
 * The preset-tier shadow: reviews the stage model hint (economy/standard/
 * best) against card context and records agreement, never overriding a
 * preset. Promotion to action waits on per-call-model support plus a
 * preset mapping that does not exist yet — until then this is evidence
 * collection with a documented promotion gate, not a silent router.
 *
 * Total by contract: rules mode, disabled hosts, unusable routes, failed
 * calls, and low confidence all resolve to null without throwing, after at
 * most one sqlite read. The api call fires only in api mode on a real band
 * swap, and the record lands in the server log (grep
 * "preset-tier shadow"), never as card spam.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isDecisionApiDisabled } from "../lib/decision-api.mjs";
import {
  DECISION_POINT_PRESET_TIER,
  normalizePointMode,
  presetTierQuestions,
  resolvePresetTier,
} from "../lib/decision-points.mjs";
import { STAGE_BY_ID, STAGE_TO_BAND } from "../lib/workflow-vocabulary.mjs";
import type { DecisionRoute } from "./decision-route.js";
import type { PointRow } from "./decision-store.js";

export interface TierShadowDeps {
  bb: Pick<BbPluginApi, "log">;
  route: DecisionRoute;
  pointRow: (point: string) => PointRow | undefined;
  parsedThresholds: (
    row: PointRow | undefined,
    point: string,
  ) => { routeAt: number };
  evaluateCall: typeof import("../lib/decision-api.mjs").evaluateDecisionCall;
}

export interface TierSuggestion {
  tier: string;
  confidence: number | null;
  expected: string;
  agreement: boolean;
}

function stageHint(stage: string): string | null {
  const hint = (STAGE_BY_ID as Record<string, { model_hint?: unknown }>)[stage]?.model_hint;
  return hint === "economy" || hint === "standard" || hint === "best" ? hint : null;
}

function tierState(card: { kind?: unknown; intent?: unknown }, stage: string, band: string | null): string {
  const kind = typeof card.kind === "string" ? card.kind : "unknown";
  const intent = typeof card.intent === "string" ? card.intent : "unknown";
  return `Card ${kind}/${intent} entering stage ${stage} (band ${band ?? "none"}). Which model tier fits the coming work?`;
}

async function suggestTierShadow(
  ctx: TierShadowDeps,
  card: { kind?: unknown; intent?: unknown },
  stage: string,
): Promise<TierSuggestion | null> {
  try {
    const expected = stageHint(stage);
    if (!expected) return null;
    const point = ctx.pointRow(DECISION_POINT_PRESET_TIER);
    const mode = normalizePointMode(point?.mode, "rules");
    if (mode !== "api" || isDecisionApiDisabled(process.env)) return null;
    const call = ctx.route.callRoute(point);
    if (!call.usable) return null;
    const result = await ctx.evaluateCall({
      provider: call.provider,
      endpoint: call.endpoint,
      apiKey: call.apiKey,
      model: call.model,
      state: tierState(card, stage, STAGE_TO_BAND[stage] ?? null),
      questions: presetTierQuestions(),
    });
    if (!result.ok) return null;
    const resolved = resolvePresetTier({
      apiAnswers: result.answers ?? null,
      routeAt: ctx.parsedThresholds(point, DECISION_POINT_PRESET_TIER).routeAt,
    });
    if (!resolved.tier) return null;
    const suggestion = {
      tier: resolved.tier,
      confidence: resolved.confidence,
      expected,
      agreement: resolved.tier === expected,
    };
    ctx.bb.log.info(
      `preset-tier shadow: stage ${stage} suggests ${suggestion.tier}`
      + ` (confidence ${suggestion.confidence ?? "n/a"}) vs hint ${expected}`
      + (suggestion.agreement ? " (agree)" : " (DISAGREE)"),
    );
    return suggestion;
  } catch {
    return null;
  }
}

export function createTierShadow(ctx: TierShadowDeps) {
  return {
    suggestTierShadow: (card: { kind?: unknown; intent?: unknown }, stage: string) =>
      suggestTierShadow(ctx, card, stage),
  };
}
