import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createDecisionApiSeams,
  type DecisionSeamDeps,
  type PointRow,
} from "./decision-api-seams.js";
import {
  DECISION_PROVIDERS,
  buildProbeCall,
  defaultEndpointFor,
  defaultModelFor,
  evaluateDecisionCall,
  isDecisionApiDisabled,
  isDecisionApiEndpointValid,
  normalizeDecisionApiModel,
  normalizeDecisionProvider,
  providerRequiresKey,
  resolveDecisionApiKey,
} from "../lib/decision-api.mjs";
import {
  DECISION_POINTS,
  defaultThresholdsFor,
  getDecisionPoint,
  normalizePointMode,
  normalizePointRoute,
  normalizeThresholds,
  pointSupportsPresetJudge,
} from "../lib/decision-points.mjs";
type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Mode = "off" | "required";
interface DecisionApiDeps
  extends Omit<DecisionSeamDeps, "configRow" | "pointRow" | "parsedThresholds"> {
  presetExists: (id: string) => boolean;
}

export { decisionApiRpcContract } from "./decision-api-contract.js";

export function runDecisionApiMigrations(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS decision_api_config (
    id INTEGER PRIMARY KEY CHECK (id = 1), endpoint TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '', model TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`);
  const configColumns = db
    .prepare("PRAGMA table_info(decision_api_config)")
    .all() as Array<{ name: string }>;
  if (!configColumns.some((column) => column.name === "provider")) {
    db.exec(
      "ALTER TABLE decision_api_config ADD COLUMN provider TEXT NOT NULL DEFAULT 'jev'",
    );
  }
  db.exec(`CREATE TABLE IF NOT EXISTS decision_points (
    point TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('rules', 'api', 'preset')),
    thresholds TEXT NOT NULL DEFAULT '{}', provider TEXT, endpoint TEXT, api_key TEXT,
    model TEXT, preset_id TEXT, updated_at INTEGER NOT NULL
  )`);
  const pointColumns = db
    .prepare("PRAGMA table_info(decision_points)")
    .all() as Array<{ name: string }>;
  if (!pointColumns.some((column) => column.name === "preset_id"))
    rebuildDecisionPoints(db);
  db.exec(`CREATE TABLE IF NOT EXISTS review_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL CHECK (mode IN ('off', 'required')), assigned_at INTEGER NOT NULL
  )`);
}

function rebuildDecisionPoints(db: Db): void {
  const rebuild = db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS decision_points_new (
      point TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('rules', 'api', 'preset')),
      thresholds TEXT NOT NULL DEFAULT '{}', provider TEXT, endpoint TEXT, api_key TEXT,
      model TEXT, preset_id TEXT, updated_at INTEGER NOT NULL
    )`);
    db.exec(
      "INSERT OR IGNORE INTO decision_points_new (point, mode, thresholds, updated_at) SELECT point, mode, thresholds, updated_at FROM decision_points",
    );
    db.exec("DROP TABLE decision_points");
    db.exec("ALTER TABLE decision_points_new RENAME TO decision_points");
  });
  rebuild();
}

export function createDecisionApi(ctx: DecisionApiDeps) {
  const { db, bb, now } = ctx;
  const configRow = () =>
    db
      .prepare(
        "SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1",
      )
      .get() as
      | {
          endpoint: string;
          api_key: string;
          model: string;
          provider: string | null;
        }
      | undefined;
  const pointRow = (point: string) =>
    db
      .prepare(
        "SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?",
      )
      .get(point) as PointRow | undefined;
  const parsedThresholds = (row: PointRow | undefined, point: string) => {
    let stored: unknown = null;
    try {
      stored = row ? JSON.parse(row.thresholds) : null;
    } catch {
      stored = null;
    }
    const thresholds = normalizeThresholds(stored, defaultThresholdsFor(point));
    return { routeAt: Number(thresholds.routeAt) };
  };
  const pointView = (def: (typeof DECISION_POINTS)[number], row?: PointRow) => {
    const route = row
      ? normalizePointRoute({
          provider: row.provider,
          endpoint: row.endpoint,
          apiKey: row.api_key,
          model: row.model,
        })
      : null;
    const hasRoute =
      route &&
      (route.provider ?? route.endpoint ?? route.apiKey ?? route.model);
    return {
      mode: normalizePointMode(row?.mode, def.defaultMode),
      thresholds: parsedThresholds(row, def.id),
      route: hasRoute ? route : null,
      presetId: row?.preset_id ?? null,
    };
  };
  const reviewPolicy = (): { mode: Mode } => {
    const row = db
      .prepare("SELECT mode FROM review_policy WHERE id = 1")
      .get() as { mode: Mode } | undefined;
    return { mode: row?.mode === "required" ? "required" : "off" };
  };

  const handlers = {
    async getDecisionApiConfig() {
      const row = configRow();
      const { key, source } = resolveDecisionApiKey({
        storedKey: row?.api_key ?? null,
        env: process.env,
      });
      const provider = normalizeDecisionProvider(row?.provider ?? "jev");
      return {
        endpoint: row?.endpoint ?? defaultEndpointFor(provider),
        model: normalizeDecisionApiModel(row?.model, defaultModelFor(provider)),
        hasKey: key !== null,
        keySource: source,
        keyRequired: providerRequiresKey(provider),
        disabled: isDecisionApiDisabled(process.env),
        provider,
        configured: row !== undefined,
      };
    },
    async setDecisionApiConfig({
      endpoint,
      apiKey,
      model,
      provider,
    }: {
      endpoint?: string | null;
      apiKey?: string | null;
      model?: string | null;
      provider?: string | null;
    }) {
      const current = configRow();
      const nextProvider =
        provider === undefined
          ? normalizeDecisionProvider(current?.provider ?? "jev")
          : normalizeDecisionProvider(provider, "");
      if (!nextProvider)
        return {
          ok: false,
          error: `Unknown provider "${provider}". Available: ${DECISION_PROVIDERS.map((entry) => entry.id).join(", ")}.`,
        };
      const nextEndpoint =
        endpoint === undefined
          ? (current?.endpoint ?? defaultEndpointFor(nextProvider))
          : (endpoint ?? defaultEndpointFor(nextProvider));
      if (!isDecisionApiEndpointValid(nextEndpoint))
        return {
          ok: false,
          error:
            "Endpoint must be an http(s) URL (e.g. https://api.typesafe.ai/v1/systemone).",
        };
      const nextModel =
        model === undefined
          ? (current?.model ?? defaultModelFor(nextProvider))
          : normalizeDecisionApiModel(model, defaultModelFor(nextProvider));
      if (!nextModel)
        return {
          ok: false,
          error: "Model must name a version (e.g. jev-latest).",
        };
      const nextKey =
        apiKey === undefined ? (current?.api_key ?? "") : (apiKey ?? "");
      db.prepare(
        "INSERT OR REPLACE INTO decision_api_config (id, endpoint, api_key, model, provider, updated_at) VALUES (1, ?, ?, ?, ?, ?)",
      ).run(nextEndpoint.trim(), nextKey, nextModel, nextProvider, now());
      return { ok: true, error: null };
    },
    async testDecisionApi() {
      if (isDecisionApiDisabled(process.env))
        return {
          ok: false,
          latencyMs: null,
          model: null,
          error:
            "Decision API is disabled on this host (STELOW_DECISION_API=0).",
        };
      const row = configRow();
      const provider = normalizeDecisionProvider(row?.provider ?? "jev");
      const { key } = resolveDecisionApiKey({
        storedKey: row?.api_key ?? null,
        env: process.env,
      });
      if (!key && providerRequiresKey(provider))
        return {
          ok: false,
          latencyMs: null,
          model: null,
          error:
            "No key: set one in Decision API settings or export DECISION_API_KEY.",
        };
      const probe = buildProbeCall(provider);
      const result = await evaluateDecisionCall({
        provider,
        endpoint: row?.endpoint ?? defaultEndpointFor(provider),
        apiKey: key ?? "",
        model: normalizeDecisionApiModel(row?.model, defaultModelFor(provider)),
        state: probe.state,
        questions: probe.questions,
      });
      return result.ok
        ? {
            ok: true,
            latencyMs: result.latencyMs ?? null,
            model: result.model ?? null,
            error: null,
          }
        : {
            ok: false,
            latencyMs: null,
            model: null,
            error: result.error ?? "the Decision API call failed",
          };
    },
    async getDecisionPoint({ point }: { point: string }) {
      const def = getDecisionPoint(point);
      return {
        point,
        ...pointView(
          def ?? {
            id: point,
            label: point,
            description: "",
            rules: "",
            defaultMode: "rules",
            defaultThresholds: { routeAt: 0.6 },
            modes: ["rules"],
            requires: null,
          },
          pointRow(point),
        ),
      };
    },
    async listDecisionPoints() {
      const rows = db
        .prepare(
          "SELECT point, mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points",
        )
        .all() as Array<PointRow & { point: string }>;
      const byId = new Map(rows.map((row) => [row.point, row]));
      return {
        points: DECISION_POINTS.map((def) => ({
          id: def.id,
          label: def.label,
          description: def.description,
          rules: def.rules,
          requires: def.requires ?? null,
          modes: [...def.modes],
          ...pointView(def, byId.get(def.id)),
        })),
      };
    },
    async setDecisionPoint({
      point,
      mode,
      thresholds,
      route,
      presetId,
    }: {
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
    }) {
      const def = getDecisionPoint(point);
      if (!def)
        return {
          ok: false,
          error: `Unknown decision point "${point}". Available: ${DECISION_POINTS.map((entry) => entry.id).join(", ")}.`,
        };
      if (!def.modes.includes(mode))
        return {
          ok: false,
          error: `Unknown mode "${mode}" for ${point}. Available: ${def.modes.join(", ")}.`,
        };
      if (mode === "api" && isDecisionApiDisabled(process.env))
        return {
          ok: false,
          error:
            "Decision API is disabled on this host (STELOW_DECISION_API=0).",
        };
      const existing = pointRow(point);
      const nextRoute =
        route === undefined
          ? normalizePointRoute({
              provider: existing?.provider ?? null,
              endpoint: existing?.endpoint ?? null,
              apiKey: existing?.api_key ?? null,
              model: existing?.model ?? null,
            })
          : normalizePointRoute(route);
      const nextPreset =
        presetId === undefined ? (existing?.preset_id ?? null) : presetId;
      if (mode === "preset") {
        if (!pointSupportsPresetJudge(point))
          return {
            ok: false,
            error: `"${point}" cannot judge via preset: hot paths stay on rules/api so judgments never burn worker turns.`,
          };
        if (!nextPreset)
          return {
            ok: false,
            error:
              "Preset mode needs a judge preset — pick any preset, including one no stage uses.",
          };
        if (!ctx.presetExists(nextPreset))
          return { ok: false, error: `Unknown preset "${nextPreset}".` };
      }
      const next = normalizeThresholds(
        thresholds ?? null,
        def.defaultThresholds,
      );
      db.prepare([
        "INSERT OR REPLACE INTO decision_points",
        "(point, mode, thresholds, provider, endpoint, api_key, model, preset_id, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" ")).run(
        point,
        mode,
        JSON.stringify(next),
        nextRoute.provider,
        nextRoute.endpoint,
        nextRoute.apiKey,
        nextRoute.model,
        nextPreset,
        now(),
      );
      bb.realtime.publish("board-changed", { point });
      return { ok: true, error: null };
    },
    async getReviewPolicy() {
      return reviewPolicy();
    },
    async setReviewPolicy({ mode }: { mode: Mode }) {
      db.prepare(
        "INSERT OR REPLACE INTO review_policy (id, mode, assigned_at) VALUES (1, ?, ?)",
      ).run(mode, now());
      bb.realtime.publish("board-changed", { reviewPolicy: mode });
      return { ok: true, error: null };
    },
  };

  const seams = createDecisionApiSeams({
    db,
    bb,
    now,
    configRow,
    pointRow,
    parsedThresholds,
    judgeViaPreset: ctx.judgeViaPreset,
  });

  return {
    handlers,
    reviewPolicy,
    ...seams,
  };
}
