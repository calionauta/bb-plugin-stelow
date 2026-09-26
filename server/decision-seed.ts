/**
 * Triage intent seeding: the criteria evaluation a card's prompt goes
 * through at creation.
 *
 * Two judges can answer — a preset judge thread, or the api route — and both
 * resolve through the same lib cascade. Every path fails soft to "unknown":
 * a misconfigured point must never break card creation, so the refusal is a
 * log line naming the fallback, not an exception.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isDecisionApiDisabled } from "../lib/decision-api.mjs";
import {
  DECISION_POINT_TRIAGE_INTENT,
  TRIAGE_INTENT_CRITERIA,
  normalizePointMode,
  resolveSeedIntent,
  triageIntentQuestions,
} from "../lib/decision-points.mjs";
import {
  buildPresetJudgePrompt,
  parsePresetJudgeOutput,
} from "../lib/preset-judge.mjs";
import type { DecisionRoute } from "./decision-route.js";
import type { PointRow } from "./decision-store.js";

export interface DecisionSeedDeps {
  bb: BbPluginApi;
  route: DecisionRoute;
  pointRow: (point: string) => PointRow | undefined;
  parsedThresholds: (
    row: PointRow | undefined,
    point: string,
  ) => { routeAt: number };
  evaluateCall: typeof import("../lib/decision-api.mjs").evaluateDecisionCall;
  judgeViaPreset: (args: {
    presetId: string;
    projectId: string | null;
    title: string;
    prompt: string;
  }) => Promise<{ ok: boolean; text: string | null; error: string | null }>;
}

function warnFallback(bb: BbPluginApi, error: string): string {
  bb.log.warn(`triage intent router fell back to built-in rules: ${error}`);
  return "unknown";
}

async function seedFromApi(
  ctx: DecisionSeedDeps,
  promptText: string,
  point: PointRow | undefined,
  routeAt: number,
): Promise<string> {
  const call = ctx.route.callRoute(point);
  if (!call.usable) return "unknown";
  const result = await ctx.evaluateCall({
    provider: call.provider,
    endpoint: call.endpoint,
    apiKey: call.apiKey,
    model: call.model,
    state: promptText,
    questions: triageIntentQuestions(),
  });
  if (!result.ok) return warnFallback(ctx.bb, result.error ?? "call failed");
  const resolved = resolveSeedIntent({ apiAnswers: result.answers, routeAt });
  if (resolved.source === "api") {
    ctx.bb.log.info(
      `triage intent seeded from Decision API: ${resolved.intent} (confidence ${resolved.confidence})`,
    );
  }
  return resolved.intent;
}

async function seedFromPreset(
  ctx: DecisionSeedDeps,
  promptText: string,
  projectId: string | null,
  point: PointRow | undefined,
  routeAt: number,
): Promise<string> {
  const presetId = point?.preset_id ?? null;
  if (!presetId) return "unknown";
  const prompt = buildPresetJudgePrompt({
    kind: "choice",
    state: promptText,
    questions: triageIntentQuestions(),
  });
  const judged = await ctx.judgeViaPreset({
    presetId,
    projectId,
    title: "Stelow judge: triage intent",
    prompt,
  });
  if (!judged.ok || !judged.text)
    return warnFallback(ctx.bb, judged.error ?? "judge failed");
  const parsed = parsePresetJudgeOutput({
    kind: "choice",
    text: judged.text,
    validChoices: Object.keys(TRIAGE_INTENT_CRITERIA),
  });
  if (!parsed.ok || !("choice" in parsed))
    return warnFallback(
      ctx.bb,
      parsed.ok ? "verdict shape mismatch" : parsed.error,
    );
  const resolved = resolveSeedIntent({
    apiAnswers: {
      intent: {
        type: "choice",
        choice: parsed.choice,
        confidence: parsed.confidence,
      },
    },
    routeAt,
  });
  if (resolved.source === "api") {
    ctx.bb.log.info(
      `triage intent seeded from preset judge (${presetId}): ${resolved.intent} (confidence ${resolved.confidence})`,
    );
  }
  return resolved.intent;
}

async function seedBuildIntent(
  ctx: DecisionSeedDeps,
  promptText: string,
  projectId: string | null,
): Promise<string> {
  try {
    if (isDecisionApiDisabled(process.env)) return "unknown";
    const point = ctx.pointRow(DECISION_POINT_TRIAGE_INTENT);
    const mode = normalizePointMode(point?.mode, "rules");
    if (mode !== "api" && mode !== "preset") return "unknown";
    const routeAt = ctx.parsedThresholds(
      point,
      DECISION_POINT_TRIAGE_INTENT,
    ).routeAt;
    if (mode === "preset")
      return seedFromPreset(ctx, promptText, projectId, point, routeAt);
    return seedFromApi(ctx, promptText, point, routeAt);
  } catch {
    return "unknown";
  }
}

export function createDecisionSeed(ctx: DecisionSeedDeps) {
  return {
    seedBuildIntent: (promptText: string, projectId: string | null) =>
      seedBuildIntent(ctx, promptText, projectId),
  };
}
