import Database from "better-sqlite3";
import { createDecisionStore, runDecisionApiMigrations } from "../../server/decision-store.ts";

// Shared harness for the decision slice tests: an in-memory database with the
// two tables the seams read, a log that can be asserted on, and the
// realtime publishes a sweep produces. One definition, so a slice test never
// re-creates a fixture that drifts from the one the next test uses.
//
// `inbox_events` carries a `kind` column on purpose: production has one on
// both sides of the severity sweep's join (core-migrations.ts), so a fixture
// without it cannot reproduce the ambiguous-column rejection a bare `kind`
// in that query causes. Keep the column even when no assertion names it.

export const ENV_KEYS = [
  "STELOW_DECISION_API",
  "DECISION_API_KEY",
  "TYPESAFE_API_KEY",
];

export function savedEnv() {
  return new Map(ENV_KEYS.map((name) => [name, process.env[name]]));
}

export function restoreEnv(saved) {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

export function clearDecisionEnv() {
  for (const name of ENV_KEYS) delete process.env[name];
}

/** A decision database plus the collaborators every seam receives. */
export function decisionHarness() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE cards (
    id TEXT PRIMARY KEY, display_name TEXT, name TEXT, kind TEXT, stage TEXT
  );
  CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, summary TEXT NOT NULL,
    kind TEXT, severity INTEGER NOT NULL, severity_reasons TEXT,
    occurred_at INTEGER NOT NULL, resolved_at INTEGER, archived_at INTEGER
  );`);
  runDecisionApiMigrations(db);
  const logs = [];
  const published = [];
  const bb = {
    log: {
      info: (line) => logs.push(["info", line]),
      warn: (line) => logs.push(["warn", line]),
      error: (line) => logs.push(["error", line]),
    },
    realtime: {
      publish: (name, payload) => published.push({ name, payload }),
    },
  };
  const now = () => 1_000_000;
  const store = createDecisionStore(db);
  return { db, bb, logs, published, now, store };
}

/** A stored point row, as `decision_points` hands it to a seam. */
export function pointRow(over = {}) {
  return {
    mode: "api",
    thresholds: '{"routeAt":0.6}',
    provider: null,
    endpoint: null,
    api_key: null,
    model: null,
    preset_id: null,
    ...over,
  };
}

/** A write for `store.savePoint`, from a stored row's route. */
export function pointWrite(over = {}) {
  return {
    mode: "api",
    thresholds: { routeAt: 0.6 },
    route: { provider: null, endpoint: null, apiKey: null, model: null },
    presetId: null,
    ...over,
  };
}

export const presetExists = (id) => id === "judge";

export const warnedAbout = (logs, fragment) =>
  logs.some(([level, line]) => level === "warn" && line.includes(fragment));
