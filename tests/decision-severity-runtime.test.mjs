import assert from "node:assert/strict";
import { createDecisionRoute } from "../server/decision-route.ts";
import { createSeverityBump } from "../server/decision-severity.ts";
import {
  clearDecisionEnv,
  decisionHarness,
  pointWrite,
  restoreEnv,
  savedEnv,
} from "./fixtures/decision-harness.mjs";

// Executable test for the inbox severity bump: the sweep is bounded,
// settled-only, promotion-only, and idempotent. A sweep that demotes,
// resolves, re-judges a checked item, re-judges a fresh item, or spends
// unboundedly fails here.

const saved = savedEnv();

try {
  clearDecisionEnv();
  const { db, bb, published, now, store } = decisionHarness();
  const route = createDecisionRoute({ configRow: store.configRow });
  store.savePoint(
    "inbox-severity",
    pointWrite({
      route: {
        provider: "classifier",
        endpoint: null,
        apiKey: null,
        model: null,
      },
    }),
    now,
  );
  db.prepare("INSERT INTO cards VALUES ('c1', 'Ship it', 'c1', 'build', 'build')").run();
  const settled = now() - 10 * 60 * 1000;
  // `kind` is written on purpose: production carries it on both sides of the
  // sweep's join, and a fixture without it would not notice a bare `kind` in
  // the candidate query going ambiguous again.
  const addEvent = (id, kind, severity, reasons, occurred, resolved = null) =>
    db
      .prepare(
        "INSERT INTO inbox_events VALUES (?, 'c1', 'Routine blocker', ?, ?, ?, ?, ?, NULL)",
      )
      .run(id, kind, severity, reasons, occurred, resolved);
  for (let index = 0; index < 4; index += 1) {
    addEvent(`e${index}`, "error", 1, null, settled);
  }
  addEvent("judged", "error", 1, '["model-judged"]', settled);
  addEvent("settling", "error", 1, null, now());
  addEvent("done", "error", 1, null, settled, now());
  addEvent("high", "error", 2, null, settled);

  const asked = [];
  const bump = (impl) =>
    createSeverityBump({
      db,
      bb,
      route,
      now,
      pointRow: store.pointRow,
      parsedThresholds: store.parsedThresholds,
      evaluateCall: async (args) => {
        asked.push(args);
        return impl(args);
      },
    });
  const blocking = (value) => async () => ({
    ok: true,
    answers: { blocking: { type: "noul", noul: value } },
  });

  await bump(blocking(0.9)).maybeBumpSeverity();
  assert.equal(asked.length, 3, "at most three settled candidates are judged per tick");
  const tiers = db
    .prepare("SELECT id, severity, severity_reasons FROM inbox_events ORDER BY id")
    .all();
  assert.deepEqual(
    tiers.filter((row) => ["e0", "e1", "e2"].includes(row.id)),
    ["e0", "e1", "e2"].map((id) => ({
      id,
      severity: 2,
      severity_reasons: '["model-judged"]',
    })),
    "a confident block escalates the tier and records the judgment reason",
  );
  assert.equal(
    tiers.find((row) => row.id === "e3").severity,
    1,
    "the fourth candidate waits for the next tick",
  );
  assert.equal(
    tiers.find((row) => row.id === "judged").severity,
    1,
    "an item already judged is never re-judged",
  );
  assert.equal(
    tiers.find((row) => row.id === "settling").severity,
    1,
    "a fresh item settles before any judgment",
  );
  assert.equal(
    tiers.find((row) => row.id === "done").severity,
    1,
    "a resolved item is never judged",
  );
  assert.equal(
    tiers.find((row) => row.id === "high").severity,
    2,
    "a higher tier is never touched",
  );
  assert.deepEqual(
    published.at(-1),
    { name: "inbox-changed", payload: { bumped: 3 } },
    "promotion publishes once, with the number that moved",
  );

  // A low score records the judgment but never escalates. Recording it is a
  // change the inbox shows, so the sweep still publishes — and the next sweep
  // finds nothing left to judge, so it stays quiet.
  published.length = 0;
  await bump(blocking(0.1)).maybeBumpSeverity();
  assert.deepEqual(
    db
      .prepare("SELECT id, severity, severity_reasons FROM inbox_events WHERE id = 'e3'")
      .get(),
    { id: "e3", severity: 1, severity_reasons: '["model-judged"]' },
    "a judged-but-not-blocking item is recorded, never escalated",
  );
  assert.deepEqual(
    published.at(-1),
    { name: "inbox-changed", payload: { bumped: 1 } },
    "a newly checked item reloads the inbox once",
  );
  published.length = 0;
  await bump(blocking(0.9)).maybeBumpSeverity();
  assert.deepEqual(published, [], "a checked item is never judged twice");

  await bump(async () => {
    throw new Error("transport");
  }).maybeBumpSeverity();
  assert.equal(
    db.prepare("SELECT severity FROM inbox_events WHERE id = 'e3'").get().severity,
    1,
    "an advisory failure leaves the deterministic tiers untouched",
  );

  // The gate the sweep is only allowed through in api mode. Each case below
  // plants a fresh, settled, unjudged item — so a sweep that ran anyway would
  // have work to do and would move it. "Nothing changed" therefore means the
  // gate stopped it, not that there was nothing to judge.
  let gateSeq = 0;
  const plantGateItem = () => {
    gateSeq += 1;
    addEvent(`gate${gateSeq}`, "error", 1, null, settled);
    return `gate${gateSeq}`;
  };
  const unjudged = () =>
    db
      .prepare(
        "SELECT id FROM inbox_events WHERE id LIKE 'gate%' AND severity_reasons IS NULL",
      )
      .all()
      .map((row) => row.id);

  const rulesItem = plantGateItem();
  const rulesRoute = {
    provider: "classifier",
    endpoint: null,
    apiKey: null,
    model: null,
  };
  store.savePoint("inbox-severity", pointWrite({ mode: "rules", route: rulesRoute }), now);
  const askedBeforeRules = asked.length;
  await bump(blocking(0.9)).maybeBumpSeverity();
  assert.equal(asked.length, askedBeforeRules, "rules mode never calls out");
  assert.deepEqual(
    unjudged(),
    [rulesItem],
    "rules mode leaves the item exactly where the deterministic tiers put it",
  );

  store.savePoint("inbox-severity", pointWrite({ route: rulesRoute }), now);
  const switchItem = plantGateItem();
  process.env.STELOW_DECISION_API = "0";
  const askedBeforeSwitch = asked.length;
  const publishedBeforeSwitch = published.length;
  await bump(blocking(0.9)).maybeBumpSeverity();
  assert.equal(asked.length, askedBeforeSwitch, "the kill switch spends no call");
  assert.equal(
    published.length,
    publishedBeforeSwitch,
    "the kill switch publishes nothing",
  );
  assert.deepEqual(
    unjudged(),
    [rulesItem, switchItem],
    "the kill switch leaves the item where the deterministic tiers put it",
  );
  delete process.env.STELOW_DECISION_API;
} finally {
  restoreEnv(saved);
}

console.log(
  "decision severity runtime test ok: bounded sweep, settled only, promotion only, idempotent",
);
