/**
 * Decision criteria evaluation for one point write: which mode a point
 * accepts, which thresholds and route a write carries, and whether a preset
 * judge may answer it.
 *
 * This module is pure — it decides, it never writes. The order of the
 * refusals is the order an operator meets them, and every refusal names a
 * valid redirect: a bad mode names the point's modes, a hot path names the
 * cost of preset judging, a missing judge names where presets are created.
 */
import { isDecisionApiDisabled } from "../lib/decision-api.mjs";
import {
  DECISION_POINTS,
  getDecisionPoint,
  normalizePointRoute,
  normalizeThresholds,
  pointSupportsPresetJudge,
} from "../lib/decision-points.mjs";
import type { DecisionPointMode, PointRow, PointWrite } from "./decision-store.js";

export interface PointWriteInput {
  point: string;
  mode: string;
  thresholds?: Record<string, number>;
  route?: {
    provider?: string | null;
    endpoint?: string | null;
    apiKey?: string | null;
    model?: string | null;
  } | null;
  presetId?: string | null;
}

export interface PointWriteDeps {
  presetExists: (id: string) => boolean;
}

type ResolvedPoint =
  | { ok: true; write: PointWrite }
  | { ok: false; error: string };

/** The registry entry an unknown point id falls back to for reads. */
export function anonymousPointDef(point: string) {
  return {
    id: point,
    label: point,
    description: "",
    rules: "",
    defaultMode: "rules" as const,
    defaultThresholds: { routeAt: 0.6 },
    modes: ["rules" as const],
    requires: null,
  };
}

/**
 * Absent route and preset parameters preserve what the point already stored,
 * so flipping a mode never silently drops a pinned model or judge.
 */
export function resolvePointWrite(
  input: PointWriteInput,
  existing: PointRow | undefined,
  deps: PointWriteDeps,
): ResolvedPoint {
  const def = getDecisionPoint(input.point);
  if (!def)
    return {
      ok: false,
      error: `Unknown decision point "${input.point}". Available: ${DECISION_POINTS.map((entry) => entry.id).join(", ")}.`,
    };
  if (!def.modes.includes(input.mode as DecisionPointMode))
    return {
      ok: false,
      error: `Unknown mode "${input.mode}" for ${input.point}. Available: ${def.modes.join(", ")}.`,
    };
  if (input.mode === "api" && isDecisionApiDisabled(process.env))
    return {
      ok: false,
      error: "Decision API is disabled on this host (STELOW_DECISION_API=0).",
    };
  const preset = resolvePresetJudge(input, existing, deps);
  if (!preset.ok) return preset;
  return {
    ok: true,
    write: {
      mode: input.mode as DecisionPointMode,
      thresholds: normalizeThresholds(
        input.thresholds ?? null,
        def.defaultThresholds,
      ),
      route: resolveRoute(input, existing),
      presetId: preset.presetId,
    },
  };
}

function resolvePresetJudge(
  input: PointWriteInput,
  existing: PointRow | undefined,
  deps: PointWriteDeps,
): { ok: true; presetId: string | null } | { ok: false; error: string } {
  const nextPreset =
    input.presetId === undefined ? (existing?.preset_id ?? null) : input.presetId;
  if (input.mode !== "preset")
    return { ok: true, presetId: nextPreset ?? null };
  if (!pointSupportsPresetJudge(input.point))
    return {
      ok: false,
      error: `"${input.point}" cannot judge via preset: hot paths stay on rules/api so judgments never burn worker turns.`,
    };
  if (!nextPreset)
    return {
      ok: false,
      error:
        "Preset mode needs a judge preset — pick any preset, including one no stage uses.",
    };
  if (!deps.presetExists(nextPreset))
    return { ok: false, error: `Unknown preset "${nextPreset}".` };
  return { ok: true, presetId: nextPreset };
}

function resolveRoute(input: PointWriteInput, existing: PointRow | undefined) {
  if (input.route !== undefined) return normalizePointRoute(input.route);
  return normalizePointRoute({
    provider: existing?.provider ?? null,
    endpoint: existing?.endpoint ?? null,
    apiKey: existing?.api_key ?? null,
    model: existing?.model ?? null,
  });
}
