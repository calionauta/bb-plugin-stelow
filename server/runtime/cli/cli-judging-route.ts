import { DECISION_POINT_ARTIFACT_CRITERIA } from "../../../lib/decision-points.mjs";
import {
  defaultEndpointFor,
  defaultModelFor,
  isDecisionApiDisabled,
  normalizeDecisionApiModel,
  normalizeDecisionProvider,
  providerRequiresKey,
  resolveDecisionApiKey,
} from "../../../lib/decision-api.mjs";
import {
  defaultThresholdsFor,
  normalizePointMode,
  normalizeThresholds,
} from "../../../lib/decision-points.mjs";
import { refuse, type CliResult, type Refusal } from "./cli-contract.js";
import type {
  CliDeps,
  DecisionConfigRow,
  DecisionPointRow,
} from "./cli-deps.js";

export type JudgingRoute = {
  mode: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  routeAt: number;
  presetId: string | null;
};

export const PRESET_NEEDS_JUDGE =
  "Preset judging needs a judge preset — pick any preset in Decision routers, including one no stage uses.";

/** The advisory judges (artifact criteria, task evidence, gap triage) all
 * route through the Artifact criteria decision point. These three steps are
 * that one routing, in the order each command needs it — enabled, then mode,
 * then the resolved route — so the commands keep their own refusal order
 * (a missing artifact still refuses before a missing key) without repeating
 * the queries. */
export function decisionApiEnabled(): CliResult | null {
  return isDecisionApiDisabled(process.env)
    ? {
        exitCode: 1,
        stderr:
          "Decision API is disabled on this host (STELOW_DECISION_API=0).",
      }
    : null;
}

export function judgingPoint(
  deps: CliDeps,
  modeRefusal: string,
): { mode: string; point: DecisionPointRow | undefined } | Refusal {
  const point = deps.db
    .prepare(
      "SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?",
    )
    .get(DECISION_POINT_ARTIFACT_CRITERIA) as DecisionPointRow | undefined;
  const mode = normalizePointMode(point?.mode, "rules");
  if (mode !== "api" && mode !== "preset") return refuse({ exitCode: 1, stderr: modeRefusal });
  return { mode, point };
}

export function judgingRoute(
  deps: CliDeps,
  point: DecisionPointRow | undefined,
  mode: string,
): JudgingRoute | Refusal {
  const config = deps.db
    .prepare(
      "SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1",
    )
    .get() as DecisionConfigRow | undefined;
  const route = deps.decisionRoute(point, config);
  const provider = normalizeDecisionProvider(route.provider ?? "jev");
  const { key } = resolveDecisionApiKey({
    storedKey: route.apiKey ?? null,
    env: process.env,
  });
  if (!key && providerRequiresKey(provider))
    return refuse({
      exitCode: 1,
      stderr:
        "No key: set one in Decision API settings or export DECISION_API_KEY.",
    });
  let stored: unknown = null;
  try {
    stored = point ? JSON.parse(point.thresholds) : null;
  } catch {
    stored = null;
  }
  const thresholds = normalizeThresholds(
    stored,
    defaultThresholdsFor(DECISION_POINT_ARTIFACT_CRITERIA),
  );
  return {
    mode,
    provider,
    endpoint: route.endpoint ?? defaultEndpointFor(provider),
    apiKey: key ?? "",
    model: normalizeDecisionApiModel(route.model, defaultModelFor(provider)),
    routeAt: thresholds.routeAt,
    presetId: point?.preset_id ?? null,
  };
}
