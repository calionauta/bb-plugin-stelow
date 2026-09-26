/**
 * Decision persistence: the three owned tables, the row readers, the
 * normalized point view, and the three writes.
 *
 * Every other decision slice reads state through this one seam, so a
 * schema, a column, or a normalization rule can only change in one place.
 * The reader types (`ConfigRow`, `PointRow`) are the seam's contract with
 * the routing and scoring slices; nothing else parses a decision row.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  DECISION_POINTS,
  defaultThresholdsFor,
  normalizePointMode,
  normalizePointRoute,
  normalizeThresholds,
} from "../lib/decision-points.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type Mode = "off" | "required";
export type DecisionPointDef = (typeof DECISION_POINTS)[number];
export type DecisionPointMode = DecisionPointDef["modes"][number];

export interface ConfigRow {
  endpoint: string;
  api_key: string;
  model: string;
  provider: string | null;
}

export interface PointRow {
  mode: string;
  thresholds: string;
  provider: string | null;
  endpoint: string | null;
  api_key: string | null;
  model: string | null;
  preset_id: string | null;
}

export interface PointRoute {
  provider: string | null;
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
}

/** Everything one point write persists, after validation resolved it. */
export interface PointWrite {
  mode: DecisionPointMode;
  thresholds: Record<string, number>;
  route: PointRoute;
  presetId: string | null;
}

export interface ConfigSave {
  endpoint: string;
  apiKey: string;
  model: string;
  provider: string;
}

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

function configRow(db: Db): ConfigRow | undefined {
  return db
    .prepare(
      "SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1",
    )
    .get() as ConfigRow | undefined;
}

function pointRow(db: Db, point: string): PointRow | undefined {
  return db
    .prepare(
      "SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?",
    )
    .get(point) as PointRow | undefined;
}

function pointRows(db: Db): Array<PointRow & { point: string }> {
  return db
    .prepare(
      "SELECT point, mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points",
    )
    .all() as Array<PointRow & { point: string }>;
}

/** Malformed stored JSON degrades to the registry defaults, never throws. */
function parsedThresholds(
  row: PointRow | undefined,
  point: string,
): { routeAt: number } {
  let stored: unknown = null;
  try {
    stored = row ? JSON.parse(row.thresholds) : null;
  } catch {
    stored = null;
  }
  const thresholds = normalizeThresholds(stored, defaultThresholdsFor(point));
  return { routeAt: Number(thresholds.routeAt) };
}

/** One point's settings as reads present them, for the single and the list. */
function pointView(def: DecisionPointDef, row?: PointRow) {
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
}

function readReviewPolicy(db: Db): { mode: Mode } {
  const row = db
    .prepare("SELECT mode FROM review_policy WHERE id = 1")
    .get() as { mode: Mode } | undefined;
  return { mode: row?.mode === "required" ? "required" : "off" };
}

function saveConfig(db: Db, next: ConfigSave, now: () => number): void {
  db.prepare(
    "INSERT OR REPLACE INTO decision_api_config (id, endpoint, api_key, model, provider, updated_at) VALUES (1, ?, ?, ?, ?, ?)",
  ).run(next.endpoint, next.apiKey, next.model, next.provider, now());
}

function savePoint(
  db: Db,
  point: string,
  write: PointWrite,
  now: () => number,
): void {
  db.prepare([
    "INSERT OR REPLACE INTO decision_points",
    "(point, mode, thresholds, provider, endpoint, api_key, model, preset_id, updated_at)",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ].join(" ")).run(
    point,
    write.mode,
    JSON.stringify(write.thresholds),
    write.route.provider,
    write.route.endpoint,
    write.route.apiKey,
    write.route.model,
    write.presetId,
    now(),
  );
}

function saveReviewPolicy(db: Db, mode: Mode, now: () => number): void {
  db.prepare(
    "INSERT OR REPLACE INTO review_policy (id, mode, assigned_at) VALUES (1, ?, ?)",
  ).run(mode, now());
}

export function createDecisionStore(db: Db) {
  return {
    configRow: () => configRow(db),
    pointRow: (point: string) => pointRow(db, point),
    pointRows: () => pointRows(db),
    parsedThresholds,
    pointView,
    readReviewPolicy: () => readReviewPolicy(db),
    saveConfig: (next: ConfigSave, now: () => number) => saveConfig(db, next, now),
    savePoint: (point: string, write: PointWrite, now: () => number) =>
      savePoint(db, point, write, now),
    saveReviewPolicy: (mode: Mode, now: () => number) =>
      saveReviewPolicy(db, mode, now),
  };
}

export type DecisionStore = ReturnType<typeof createDecisionStore>;
