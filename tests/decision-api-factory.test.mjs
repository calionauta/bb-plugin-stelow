import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  createDecisionApi,
  runDecisionApiMigrations,
} from "../server/decision-api.ts";

function harness(
  now = 1_000,
  evaluateImpl = async () => ({ ok: false, error: "test stub" }),
) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE cards (
    id TEXT PRIMARY KEY, display_name TEXT, name TEXT, kind TEXT, stage TEXT
  );
  CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, summary TEXT NOT NULL,
    severity INTEGER NOT NULL, severity_reasons TEXT, occurred_at INTEGER NOT NULL,
    resolved_at INTEGER, archived_at INTEGER
  );`);
  runDecisionApiMigrations(db);
  const events = [];
  const bb = {
    log: { info() {}, warn() {}, error() {} },
    realtime: { publish: (name, payload) => events.push({ name, payload }) },
  };
  let judgeCalls = 0;
  let evaluateCalls = 0;
  const api = createDecisionApi({
    db,
    bb,
    now: () => now,
    evaluateCall: async (args) => {
      evaluateCalls += 1;
      return evaluateImpl(args);
    },
    judgeViaPreset: async () => {
      judgeCalls += 1;
      return { ok: true, text: "not used", error: null };
    },
    presetExists: (id) => id === "judge",
  });
  return {
    db,
    api,
    events,
    judgeCalls: () => judgeCalls,
    evaluateCalls: () => evaluateCalls,
  };
}

const originalFlag = process.env.STELOW_DECISION_API;
try {
  delete process.env.STELOW_DECISION_API;
  const { db, api, events } = harness();

  // Fresh and repeat migrations create every owned table without disturbing
  // settings. The provider backfill keeps pre-adapter rows on the keyed path.
  runDecisionApiMigrations(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.ok(tables.includes("decision_api_config"));
  assert.ok(tables.includes("decision_points"));
  assert.ok(tables.includes("review_policy"));
  assert.ok(
    db
      .prepare("PRAGMA table_info(decision_api_config)")
      .all()
      .some((row) => row.name === "provider"),
  );

  // Reads disclose key presence and source only. Adding the raw key to this
  // result would fail the explicit absence check even if hasKey stayed true.
  assert.deepEqual(await api.handlers.getDecisionApiConfig(), {
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    hasKey: false,
    keySource: null,
    keyRequired: true,
    disabled: false,
    provider: "jev",
    configured: false,
  });

  const saved = await api.handlers.setDecisionApiConfig({
    endpoint: "https://decision.test/v1",
    apiKey: "stored-secret",
    model: "custom-model",
    provider: "simplejev",
  });
  assert.deepEqual(saved, { ok: true, error: null });
  const exposed = await api.handlers.getDecisionApiConfig();
  assert.equal(exposed.hasKey, true);
  assert.equal(exposed.keySource, "settings");
  assert.equal(Object.hasOwn(exposed, "apiKey"), false);
  assert.equal(JSON.stringify(exposed).includes("stored-secret"), false);

  // Absent fields preserve stored values; explicit null clears only the key.
  assert.deepEqual(
    await api.handlers.setDecisionApiConfig({ model: "next-model" }),
    { ok: true, error: null },
  );
  assert.equal((await api.handlers.getDecisionApiConfig()).model, "next-model");
  assert.equal((await api.handlers.getDecisionApiConfig()).hasKey, true);
  assert.deepEqual(await api.handlers.setDecisionApiConfig({ apiKey: null }), {
    ok: true,
    error: null,
  });
  assert.equal((await api.handlers.getDecisionApiConfig()).hasKey, false);

  const unknownProvider = await api.handlers.setDecisionApiConfig({
    provider: "mystery",
  });
  assert.equal(unknownProvider.ok, false);
  assert.match(
    unknownProvider.error,
    /Available: jev, classifier, simplejev, openjev/,
  );

  // Point writes fail closed with a valid redirect, preserve omitted fields,
  // and reject hot-path preset judging before persisting anything.
  const unknownPoint = await api.handlers.setDecisionPoint({
    point: "mystery",
    mode: "api",
  });
  assert.equal(unknownPoint.ok, false);
  assert.match(unknownPoint.error, /Available: artifact-criteria/);
  const unknownMode = await api.handlers.setDecisionPoint({
    point: "triage-intent",
    mode: "mystery",
  });
  assert.match(unknownMode.error, /Available: rules, api, preset/);
  const hotPreset = await api.handlers.setDecisionPoint({
    point: "auto-continue",
    mode: "preset",
    presetId: "judge",
  });
  assert.equal(hotPreset.ok, false);
  assert.match(hotPreset.error, /Available: rules, api/);
  const missingPreset = await api.handlers.setDecisionPoint({
    point: "triage-intent",
    mode: "preset",
  });
  assert.match(missingPreset.error, /needs a judge preset/);
  const unknownPreset = await api.handlers.setDecisionPoint({
    point: "triage-intent",
    mode: "preset",
    presetId: "missing",
  });
  assert.match(unknownPreset.error, /Unknown preset "missing"/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM decision_points").get().count,
    0,
  );

  assert.deepEqual(
    await api.handlers.setDecisionPoint({
      point: "triage-intent",
      mode: "api",
      thresholds: { routeAt: 0.8 },
      route: { model: "point-model" },
      presetId: "judge",
    }),
    { ok: true, error: null },
  );
  const point = await api.handlers.getDecisionPoint({ point: "triage-intent" });
  assert.equal(point.mode, "api");
  assert.deepEqual(point.thresholds, { routeAt: 0.8 });
  assert.equal(point.route.model, "point-model");
  assert.equal(point.route.endpoint, null);
  assert.equal(point.presetId, "judge");
  await api.handlers.setDecisionPoint({ point: "triage-intent", mode: "rules" });
  const flipped = await api.handlers.getDecisionPoint({ point: "triage-intent" });
  assert.equal(flipped.mode, "rules");
  assert.equal(flipped.route.model, "point-model");
  assert.equal(flipped.presetId, "judge");
  assert.equal(
    api.routeConfig({
      mode: "api",
      thresholds: "{}",
      provider: null,
      endpoint: null,
      api_key: null,
      model: "point-model",
    }).endpoint,
    "https://decision.test/v1",
    "runtime judgments fill omitted route fields from shared settings",
  );
  assert.equal(events.at(-1).name, "board-changed");

  // Review policy is one owned singleton with a typed RPC surface.
  assert.deepEqual(await api.handlers.getReviewPolicy(), { mode: "off" });
  assert.deepEqual(await api.handlers.setReviewPolicy({ mode: "required" }), {
    ok: true,
    error: null,
  });
  assert.deepEqual(api.reviewPolicy(), { mode: "required" });
  assert.deepEqual(events.at(-1), {
    name: "board-changed",
    payload: { reviewPolicy: "required" },
  });

  // The operator kill switch blocks both persistence and execution before an
  // injected judge or outbound API could spend a turn.
  process.env.STELOW_DECISION_API = "0";
  const disabled = harness(1_000, async () => ({
    ok: true,
    answers: { blocking: { type: "noul", noul: 1 } },
  }));
  assert.equal(
    (
      await disabled.api.handlers.setDecisionPoint({
        point: "triage-intent",
        mode: "api",
      })
    ).ok,
    false,
  );
  assert.equal(
    await disabled.api.seedBuildIntent("add dark mode", "project"),
    "unknown",
  );
  assert.equal(await disabled.api.vetAutoContinue("only tool calls"), true);
  disabled.db.prepare("INSERT INTO decision_api_config VALUES (1, 'https://decision.test/v1', 'key', 'model', 'jev', 1)").run();
  disabled.db.prepare("INSERT INTO decision_points VALUES ('inbox-severity', 'api', '{\"routeAt\":0.6}', NULL, NULL, NULL, NULL, NULL, 1)").run();
  disabled.db.prepare("INSERT INTO cards VALUES ('card-1', 'Card', 'card-1', 'build', 'build')").run();
  disabled.db.prepare("INSERT INTO inbox_events VALUES ('event-1', 'card-1', 'Routine blocker', 1, NULL, 0, NULL, NULL)").run();
  await disabled.api.maybeBumpSeverity();
  assert.equal(disabled.evaluateCalls(), 0, "the kill switch blocks severity calls before the injected evaluator");
  assert.deepEqual(
    disabled.db.prepare("SELECT severity, severity_reasons FROM inbox_events WHERE id = 'event-1'").get(),
    { severity: 1, severity_reasons: null },
    "the kill switch leaves deterministic severity tiers unchanged",
  );
  assert.equal(disabled.judgeCalls(), 0);
  assert.match(
    (await disabled.api.handlers.testDecisionApi()).error,
    /STELOW_DECISION_API=0/,
  );
} finally {
  if (originalFlag === undefined) delete process.env.STELOW_DECISION_API;
  else process.env.STELOW_DECISION_API = originalFlag;
}

// A legacy two-mode table is rebuilt atomically with its rows intact. Losing
// either row would make operators silently fall back to built-in rules.
const legacy = new Database(":memory:");
legacy.exec(`CREATE TABLE decision_api_config (
  id INTEGER PRIMARY KEY CHECK (id = 1), endpoint TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '', model TEXT NOT NULL, updated_at INTEGER NOT NULL
);
INSERT INTO decision_api_config VALUES (1, 'https://legacy.test/v1', 'legacy-key', 'legacy-model', 5);
CREATE TABLE decision_points (
  point TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('rules', 'api')),
  thresholds TEXT NOT NULL DEFAULT '{}',
  provider TEXT, endpoint TEXT, api_key TEXT, model TEXT,
  updated_at INTEGER NOT NULL
);
INSERT INTO decision_points (point, mode, thresholds, updated_at)
VALUES ('triage-intent', 'api', '{"routeAt":0.9}', 10),
       ('auto-continue', 'rules', '{}', 20);`);
runDecisionApiMigrations(legacy);
assert.deepEqual(
  legacy.prepare("SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1").get(),
  { endpoint: "https://legacy.test/v1", api_key: "legacy-key", model: "legacy-model", provider: "jev" },
  "pre-adapter shared settings survive and default to the keyed jev provider",
);
assert.deepEqual(
  legacy
    .prepare(
      "SELECT point, mode, thresholds FROM decision_points ORDER BY point",
    )
    .all(),
  [
    { point: "auto-continue", mode: "rules", thresholds: "{}" },
    { point: "triage-intent", mode: "api", thresholds: '{"routeAt":0.9}' },
  ],
);
legacy.close();

console.log(
  "decision api factory test ok: migrations, key secrecy, refusals, review policy, disabled seams",
);
