/**
 * The auto-continue veto: the router may only hold the heuristic back, never
 * resume on its own. Worker turns are the expensive thing here, so every
 * path that is not a confident "no real progress" keeps the heuristic
 * standing — empty output, rules mode, the kill switch, a keyless provider,
 * a failed call, and any thrown error.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isDecisionApiDisabled } from "../lib/decision-api.mjs";
import {
  DECISION_POINT_AUTO_CONTINUE,
  autoContinueQuestions,
  normalizePointMode,
  resolveAutoContinue,
} from "../lib/decision-points.mjs";
import type { DecisionRoute } from "./decision-route.js";
import type { PointRow } from "./decision-store.js";

export interface DecisionAutoContinueDeps {
  bb: BbPluginApi;
  route: DecisionRoute;
  pointRow: (point: string) => PointRow | undefined;
  parsedThresholds: (
    row: PointRow | undefined,
    point: string,
  ) => { routeAt: number };
  evaluateCall: typeof import("../lib/decision-api.mjs").evaluateDecisionCall;
}

/** One call plus the lib resolution; every failure keeps the heuristic. */
async function askRouter(
  ctx: DecisionAutoContinueDeps,
  stateText: string,
  point: PointRow | undefined,
): Promise<boolean> {
  const call = ctx.route.callRoute(point);
  if (!call.usable) return true;
  const result = await ctx.evaluateCall({
    provider: call.provider,
    endpoint: call.endpoint,
    apiKey: call.apiKey,
    model: call.model,
    state: stateText,
    questions: autoContinueQuestions(),
  });
  if (!result.ok) {
    ctx.bb.log.warn(
      `auto-continue veto skipped, heuristic stands: ${result.error ?? "call failed"}`,
    );
    return true;
  }
  const answer = result.answers?.progress ?? null;
  const progress = answer?.type === "noul" ? answer.noul : "n/a";
  const resolved = resolveAutoContinue({
    apiNoul: answer?.type === "noul" ? answer.noul : null,
    routeAt: ctx.parsedThresholds(point, DECISION_POINT_AUTO_CONTINUE).routeAt,
  });
  if (!resolved.proceed) {
    ctx.bb.log.info(
      `auto-continue vetoed by Decision API (progress ${progress})`,
    );
  }
  return resolved.proceed;
}

async function vetAutoContinue(
  ctx: DecisionAutoContinueDeps,
  stateText: string | null,
): Promise<boolean> {
  try {
    if (!stateText?.trim()) return true;
    const point = ctx.pointRow(DECISION_POINT_AUTO_CONTINUE);
    const mode = normalizePointMode(point?.mode, "rules");
    if (mode === "preset") {
      ctx.bb.log.warn(
        "auto-continue ignores preset mode: hot paths stay on rules/api so judgments never burn worker turns.",
      );
    }
    if (mode !== "api" || isDecisionApiDisabled(process.env)) return true;
    return await askRouter(ctx, stateText, point);
  } catch {
    return true;
  }
}

export function createAutoContinueVeto(ctx: DecisionAutoContinueDeps) {
  return {
    vetAutoContinue: (stateText: string | null) =>
      vetAutoContinue(ctx, stateText),
  };
}
