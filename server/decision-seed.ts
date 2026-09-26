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

/** The answer map both judges hand to the resolver, taken from the resolver's
 *  own inferred signature so neither call site restates the shape. Every field
 *  of it is optional — the cascade tolerates a malformed map by design — so it
 *  documents the contract rather than enforcing it. */
type SeedAnswers = Parameters<typeof resolveSeedIntent>[0]["apiAnswers"];

/**
 * The tail both judges share: resolve the answer against the point's routeAt,
 * announce it when — and only when — the threshold accepted it, and return the
 * intent. The threshold has to be applied identically whichever judge produced
 * the answer, so it lives here rather than at the two call sites.
 *
 * A rejected answer is not a failure: it falls back to the built-in rules
 * silently, which is why this logs on acceptance alone, at info. The `source`
 * argument is the judge that answered — it carries no logic, it only names
 * which of the two produced a seed worth keeping a record of.
 */
function applySeedIntent(
  ctx: DecisionSeedDeps,
  apiAnswers: SeedAnswers,
  routeAt: number,
  source: string,
): string {
  const resolved = resolveSeedIntent({ apiAnswers, routeAt });
  if (resolved.source === "api") {
    ctx.bb.log.info(
      `triage intent seeded from ${source}: ${resolved.intent} (confidence ${resolved.confidence})`,
    );
  }
  return resolved.intent;
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
  return applySeedIntent(ctx, result.answers, routeAt, "Decision API");
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
  return applySeedIntent(
    ctx,
    {
      intent: {
        type: "choice",
        choice: parsed.choice,
        confidence: parsed.confidence,
      },
    },
    routeAt,
    `preset judge (${presetId})`,
  );
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
    // `await`, not a bare return: returning a promise completes this block, so
    // a rejection would escape the catch below and break card creation instead
    // of degrading to the built-in rules.
    if (mode === "preset")
      return await seedFromPreset(ctx, promptText, projectId, point, routeAt);
    return await seedFromApi(ctx, promptText, point, routeAt);
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
