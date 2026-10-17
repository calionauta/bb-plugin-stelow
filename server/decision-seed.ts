/**
 * Triage intent seeding: the criteria evaluation a card's prompt goes
 * through at creation.
 *
 * One judge answers — the deterministic Decision API route — and resolves
 * through the lib cascade. Every path fails soft to "unknown": a
 * misconfigured point must never break card creation, so the refusal is a
 * log line naming the fallback, not an exception. Preset mode is refused
 * to built-in rules (no hidden judge thread).
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isDecisionApiDisabled } from "../lib/decision-api.mjs";
import {
  DECISION_POINT_TRIAGE_INTENT,
  normalizePointMode,
  resolveSeedIntent,
  triageIntentQuestions,
} from "../lib/decision-points.mjs";
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
  judgeViaPreset?: (args: {
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

/** The answer map the deterministic judge hands to the resolver, taken from the resolver's
 *  own inferred signature so the call site never restates the shape. Every field
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

function seedFromPresetDisabled(): string {
  return "unknown";
}

async function seedBuildIntent(
  ctx: DecisionSeedDeps,
  promptText: string,
  _projectId: string | null,
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
    // of degrading to the built-in rules. Preset mode has no judge thread:
    // it degrades to built-in rules like a refused api call.
    if (mode === "preset") {
      ctx.bb.log.warn("triage intent router fell back to built-in rules: preset judge disabled");
      return seedFromPresetDisabled();
    }
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
