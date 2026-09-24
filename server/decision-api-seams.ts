import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { parseSeverityReasons } from "../lib/inbox-severity.mjs";
import {
  defaultEndpointFor,
  defaultModelFor,
  evaluateDecisionCall,
  isDecisionApiDisabled,
  meetsDecisionThreshold,
  normalizeDecisionApiModel,
  normalizeDecisionProvider,
  providerRequiresKey,
  resolveDecisionApiKey,
} from "../lib/decision-api.mjs";
import {
  DECISION_POINT_AUTO_CONTINUE,
  DECISION_POINT_INBOX_SEVERITY,
  DECISION_POINT_TRIAGE_INTENT,
  TRIAGE_INTENT_CRITERIA,
  autoContinueQuestions,
  normalizePointMode,
  resolveAutoContinue,
  resolvePointRoute,
  resolveSeedIntent,
  severityBumpQuestions,
  triageIntentQuestions,
} from "../lib/decision-points.mjs";
import {
  buildPresetJudgePrompt,
  parsePresetJudgeOutput,
} from "../lib/preset-judge.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export interface PointRow {
  mode: string;
  thresholds: string;
  provider: string | null;
  endpoint: string | null;
  api_key: string | null;
  model: string | null;
  preset_id: string | null;
}

interface ConfigRow {
  endpoint: string;
  api_key: string;
  model: string;
  provider: string | null;
}

export interface DecisionSeamDeps {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  configRow: () => ConfigRow | undefined;
  pointRow: (point: string) => PointRow | undefined;
  parsedThresholds: (
    row: PointRow | undefined,
    point: string,
  ) => { routeAt: number };
  evaluateCall?: typeof evaluateDecisionCall;
  judgeViaPreset: (args: {
    presetId: string;
    projectId: string | null;
    title: string;
    prompt: string;
  }) => Promise<{ ok: boolean; text: string | null; error: string | null }>;
}

export function createDecisionApiSeams(ctx: DecisionSeamDeps) {
  const { db, bb, now } = ctx;
  const evaluateCall = ctx.evaluateCall ?? evaluateDecisionCall;

  const routeConfig = (point: PointRow | undefined, cfg = ctx.configRow()) =>
    resolvePointRoute({
      override: point
        ? {
            provider: point.provider,
            endpoint: point.endpoint,
            apiKey: point.api_key,
            model: point.model,
          }
        : null,
      fallback: cfg ?? {
        provider: null,
        endpoint: "",
        api_key: "",
        model: "",
      },
    });

  async function seedBuildIntent(
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
      if (mode === "preset") {
        return seedFromPreset(promptText, projectId, point, routeAt);
      }
      return seedFromApi(promptText, point, routeAt);
    } catch {
      return "unknown";
    }
  }

  async function seedFromPreset(
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
    if (!judged.ok || !judged.text) {
      return warnSeedFallback(judged.error ?? "judge failed");
    }
    const parsed = parsePresetJudgeOutput({
      kind: "choice",
      text: judged.text,
      validChoices: Object.keys(TRIAGE_INTENT_CRITERIA),
    });
    if (!parsed.ok || !("choice" in parsed)) {
      return warnSeedFallback(
        parsed.ok ? "verdict shape mismatch" : parsed.error,
      );
    }
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
      bb.log.info(
        `triage intent seeded from preset judge (${presetId}): ${resolved.intent} (confidence ${resolved.confidence})`,
      );
    }
    return resolved.intent;
  }

  async function seedFromApi(
    promptText: string,
    point: PointRow | undefined,
    routeAt: number,
  ): Promise<string> {
    const route = routeConfig(point);
    const provider = normalizeDecisionProvider(route.provider ?? "jev");
    const { key } = resolveDecisionApiKey({
      storedKey: route.apiKey ?? null,
      env: process.env,
    });
    if (!key && providerRequiresKey(provider)) return "unknown";
    const result = await evaluateCall({
      provider,
      endpoint: route.endpoint ?? defaultEndpointFor(provider),
      apiKey: key ?? "",
      model: normalizeDecisionApiModel(route.model, defaultModelFor(provider)),
      state: promptText,
      questions: triageIntentQuestions(),
    });
    if (!result.ok) return warnSeedFallback(result.error ?? "call failed");
    const resolved = resolveSeedIntent({ apiAnswers: result.answers, routeAt });
    if (resolved.source === "api") {
      bb.log.info(
        `triage intent seeded from Decision API: ${resolved.intent} (confidence ${resolved.confidence})`,
      );
    }
    return resolved.intent;
  }

  function warnSeedFallback(error: string): string {
    bb.log.warn(`triage intent router fell back to built-in rules: ${error}`);
    return "unknown";
  }

  async function vetAutoContinue(stateText: string | null): Promise<boolean> {
    try {
      if (!stateText?.trim()) return true;
      const point = ctx.pointRow(DECISION_POINT_AUTO_CONTINUE);
      if (normalizePointMode(point?.mode, "rules") === "preset") {
        bb.log.warn(
          "auto-continue ignores preset mode: hot paths stay on rules/api so judgments never burn worker turns.",
        );
      }
      if (
        normalizePointMode(point?.mode, "rules") !== "api" ||
        isDecisionApiDisabled(process.env)
      ) {
        return true;
      }
      const route = routeConfig(point);
      const provider = normalizeDecisionProvider(route.provider ?? "jev");
      const { key } = resolveDecisionApiKey({
        storedKey: route.apiKey ?? null,
        env: process.env,
      });
      if (!key && providerRequiresKey(provider)) return true;
      const result = await evaluateCall({
        provider,
        endpoint: route.endpoint ?? defaultEndpointFor(provider),
        apiKey: key ?? "",
        model: normalizeDecisionApiModel(
          route.model,
          defaultModelFor(provider),
        ),
        state: stateText,
        questions: autoContinueQuestions(),
      });
      if (!result.ok) {
        bb.log.warn(
          `auto-continue veto skipped, heuristic stands: ${result.error ?? "call failed"}`,
        );
        return true;
      }
      const answer = result.answers?.progress ?? null;
      const resolved = resolveAutoContinue({
        apiNoul: answer?.type === "noul" ? answer.noul : null,
        routeAt: ctx.parsedThresholds(point, DECISION_POINT_AUTO_CONTINUE)
          .routeAt,
      });
      if (!resolved.proceed) {
        bb.log.info(
          `auto-continue vetoed by Decision API (progress ${answer?.type === "noul" ? answer.noul : "n/a"})`,
        );
      }
      return resolved.proceed;
    } catch {
      return true;
    }
  }

  async function maybeBumpSeverity(): Promise<void> {
    try {
      const point = ctx.pointRow(DECISION_POINT_INBOX_SEVERITY);
      if (normalizePointMode(point?.mode, "rules") === "preset") {
        bb.log.warn(
          "inbox severity ignores preset mode: hot paths stay on rules/api so judgments never burn worker turns.",
        );
      }
      if (
        normalizePointMode(point?.mode, "rules") !== "api" ||
        isDecisionApiDisabled(process.env)
      ) {
        return;
      }
      const route = routeConfig(point);
      const provider = normalizeDecisionProvider(route.provider ?? "jev");
      const { key } = resolveDecisionApiKey({
        storedKey: route.apiKey ?? null,
        env: process.env,
      });
      if (!key && providerRequiresKey(provider)) return;
      const rows = severityCandidates();
      let changed = 0;
      for (const row of rows) {
        changed += await judgeSeverityRow(row, point, route, provider, key);
      }
      if (changed > 0)
        bb.realtime.publish("inbox-changed", { bumped: changed });
    } catch {
      /* advisory only — tiers stand without the bump */
    }
  }

  function severityCandidates() {
    return db
      .prepare([
        "SELECT id, summary, severity_reasons, display_name, name, kind AS card_kind, stage",
        "FROM inbox_events JOIN cards ON cards.id = inbox_events.card_id",
        "WHERE resolved_at IS NULL AND archived_at IS NULL AND severity = 1",
        "AND occurred_at <= ? AND severity_reasons NOT LIKE '%model-judged%'",
        "ORDER BY occurred_at ASC LIMIT 3",
      ].join(" "))
      .all(now() - 5 * 60 * 1000) as Array<{
      id: string;
      summary: string;
      severity_reasons: string | null;
      display_name: string | null;
      name: string;
      card_kind: string | null;
      stage: string;
    }>;
  }

  async function judgeSeverityRow(
    row: ReturnType<typeof severityCandidates>[number],
    point: PointRow | undefined,
    route: ReturnType<typeof routeConfig>,
    provider: string,
    key: string | null,
  ): Promise<number> {
    const state = `Card "${row.display_name ?? row.name}" (${row.card_kind ?? "build"}, stage ${row.stage}): ${row.summary}`;
    const result = await evaluateCall({
      provider,
      endpoint: route.endpoint ?? defaultEndpointFor(provider),
      apiKey: key ?? "",
      model: normalizeDecisionApiModel(route.model, defaultModelFor(provider)),
      state,
      questions: severityBumpQuestions(),
    }).catch(() => null);
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
    return db.prepare(sql).run(reasons, row.id).changes;
  }

  return { routeConfig, seedBuildIntent, vetAutoContinue, maybeBumpSeverity };
}
