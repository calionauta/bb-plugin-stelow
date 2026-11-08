import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { judgeRetryTransientError } from "../server/decision-retry.ts";
import { runDecisionApiMigrations } from "../server/decision-store.ts";

function voicedDb() {
  const db = new Database(":memory:");
  runDecisionApiMigrations(db);
  return db;
}

function writePoint(db, write) {
  db.prepare([
    "INSERT OR REPLACE INTO decision_points",
    "(point, mode, thresholds, provider, endpoint, api_key, model, preset_id, updated_at)",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ].join(" ")).run(
    "retry-transient",
    write.mode,
    JSON.stringify(write.thresholds ?? { routeAt: 0.7 }),
    write.provider ?? null,
    write.endpoint ?? null,
    write.apiKey ?? null,
    write.model ?? null,
    null,
    Date.now(),
  );
}

const noulFetch = (noul) => async () => ({
  status: 200,
  json: async () => ({ answers: { transient: { type: "noul", noul } } }),
});
const deadFetch = async () => { throw new Error("boom"); };

// Rules default: never calls out, even with a fetch ready to answer.
{
  const db = voicedDb();
  let called = 0;
  const counting = async (...args) => { called += 1; return noulFetch(0.95)(...args); };
  assert.equal(await judgeRetryTransientError({ db, fetchImpl: counting }, "weird flake", 1), false);
  assert.equal(called, 0, "rules mode makes no outbound call");
}

// API mode, confident transient: rescues.
{
  const db = voicedDb();
  writePoint(db, { mode: "api" });
  assert.equal(
    await judgeRetryTransientError({ db, fetchImpl: noulFetch(0.95) }, "weird flake", 1),
    true,
    "confident transient returns true",
  );
}

// API mode, low confidence: fail-fast stands.
{
  const db = voicedDb();
  writePoint(db, { mode: "api" });
  assert.equal(await judgeRetryTransientError({ db, fetchImpl: noulFetch(0.3) }, "weird flake", 1), false);
}

// Dead provider: fail-fast, never throw.
{
  const db = voicedDb();
  writePoint(db, { mode: "api" });
  const warnings = [];
  assert.equal(
    await judgeRetryTransientError({ db, fetchImpl: deadFetch, log: (message) => warnings.push(message) }, "weird flake", 1),
    false,
  );
  assert.equal(warnings.length, 1, "one warn names the skip");
}

// Labels provider with a Noul question: the wire refuses, fail-fast stands.
{
  const db = voicedDb();
  writePoint(db, { mode: "api", provider: "classifier" });
  let called = 0;
  const counting = async (...args) => { called += 1; return noulFetch(0.95)(...args); };
  assert.equal(await judgeRetryTransientError({ db, fetchImpl: counting }, "weird flake", 1), false);
  assert.equal(called, 0, "labels providers never see the Noul");
}

// Kill switch: no call even in api mode.
{
  const db = voicedDb();
  writePoint(db, { mode: "api" });
  process.env.STELOW_DECISION_API = "0";
  try {
    let called = 0;
    const counting = async (...args) => { called += 1; return noulFetch(0.95)(...args); };
    assert.equal(await judgeRetryTransientError({ db, fetchImpl: counting }, "weird flake", 1), false);
    assert.equal(called, 0, "kill switch blocks the call");
  } finally {
    delete process.env.STELOW_DECISION_API;
  }
}

// Empty cause: false without touching the database tables.
{
  const db = voicedDb();
  assert.equal(await judgeRetryTransientError({ db }, "   ", 1), false);
}

console.log("decision retry judge test ok: rules-first, api rescue, fail-open, labels, kill switch");
