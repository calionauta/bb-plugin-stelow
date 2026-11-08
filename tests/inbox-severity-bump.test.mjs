import assert from "node:assert/strict";
import { isDecisionApiDisabled, meetsDecisionThreshold } from "../lib/decision-api.mjs";
import { getDecisionPoint, severityBumpQuestions } from "../lib/decision-points.mjs";
import { parseSeverityReasons } from "../lib/inbox-severity.mjs";
import { createSeverityBump } from "../server/decision-severity.ts";

// Inbox-severity bump: advisory bump-only over deterministic tiers. A
// confident blocking judgment promotes severity 1 to 2; everything else
// keeps the tier. Never demotes, never resolves, never re-judges a checked
// item. Bounded: at most 3 judgments per sweep, items older than 5min.

const ROUTE_AT = getDecisionPoint("inbox-severity")?.defaultThresholds?.routeAt ?? 0.6;

// The question is exactly one noul: does this item describe a blocked worker?
const questions = severityBumpQuestions();
assert.deepEqual(Object.keys(questions), ["blocking"], "the bump asks exactly one question");
assert.equal(questions.blocking.type, "noul", "blocking is a yes/no judgment");

// Threshold behavior: only confident blocking bumps.
assert.equal(meetsDecisionThreshold(0.9, ROUTE_AT), true, "confident blocking clears the floor");
assert.equal(meetsDecisionThreshold(0.3, ROUTE_AT), false, "low confidence keeps the tier");
assert.equal(meetsDecisionThreshold(null, ROUTE_AT), false, "a missing confidence never bumps");
assert.equal(meetsDecisionThreshold(0.9, undefined), false, "a missing floor never bumps");

// The model-judged tag is append-only: parsing preserves it, and the seam
// tags every judged row whether or not it promoted — checked items never
// re-judge.
assert.deepEqual(parseSeverityReasons('["paused", "model-judged"]'), ["paused", "model-judged"], "the tag survives parsing");
assert.ok(parseSeverityReasons(null).length === 0, "missing reasons parse empty, never throw");

// The severity sweep is its own module: the decision API has several seams, and
// these bounds belong to the one that re-judges inbox items. Proven through
// the queries and writes the sweep actually issues (captured call args), not
// the file text — moving the module never breaks this.
function bumpHarness({ rows, noul = 0.9, mode = "api" } = {}) {
  const prepared = [];
  const writes = [];
  const published = [];
  const cutoffs = [];
  let judgments = 0;
  const rowList = rows ?? [{
    id: "ev_1",
    summary: "worker stuck",
    severity_reasons: null,
    display_name: "Card",
    name: "Card",
    card_kind: "build",
    stage: "shape",
  }];
  const db = {
    prepare: (sql) => {
      prepared.push(sql);
      return {
        all: (cutoff) => {
          cutoffs.push(cutoff);
          return rowList;
        },
        run: (reasons, id) => {
          writes.push({ sql, reasons: JSON.parse(reasons), id });
          return { changes: 1 };
        },
      };
    },
  };
  const ctx = {
    db,
    bb: { log: { warn: () => undefined }, realtime: { publish: (event, payload) => published.push({ event, payload }) } },
    route: { callRoute: () => ({ usable: true, provider: "stub", endpoint: "http://x", apiKey: "k", model: "m" }) },
    now: () => 1_000_000,
    pointRow: () => ({ mode }),
    parsedThresholds: () => ({ routeAt: 0.6 }),
    evaluateCall: async () => {
      judgments++;
      return { ok: true, answers: { blocking: { type: "noul", noul } } };
    },
  };
  return { ctx, prepared, writes, published, cutoffs, judgments: () => judgments };
}

// Scope bounds: only open severity-1 items older than 5 minutes, at most 3
// per sweep, never re-judging a checked item. The sweep issues one statement,
// so each bound is proven where the module states it — in the captured query.
{
  const { ctx, prepared, cutoffs } = bumpHarness();
  await createSeverityBump(ctx).maybeBumpSeverity();
  const select = prepared.find((sql) => sql.includes("FROM inbox_events"));
  assert.ok(select, "the bump reads through one statement");
  assert.match(
    select,
    /WHERE inbox_events\.resolved_at IS NULL AND inbox_events\.archived_at IS NULL/,
    "the bump reads open routine items only — escalations and closed rows are out of scope",
  );
  assert.match(select, /AND inbox_events\.severity = 1/, "only routine severity-1 items are re-judged");
  assert.match(select, /NOT LIKE '%model-judged%'/, "checked items never re-judge");
  assert.match(select, /ORDER BY inbox_events\.occurred_at ASC LIMIT 3/, "at most three judgments per sweep, oldest first");
  assert.deepEqual(cutoffs, [1_000_000 - 5 * 60 * 1000], "fresh items settle: only items older than 5 minutes are candidates");
}

// Promotion-only: the sweep's only severity write escalates 1 to 2. A
// regression that demotes, resolves, or archives fails here.
{
  const confident = bumpHarness({ noul: 0.9 });
  await createSeverityBump(confident.ctx).maybeBumpSeverity();
  assert.equal(confident.writes.length, 1, "one judgment, one write");
  assert.ok(confident.writes[0].sql.includes("SET severity = 2"), "promotion escalates to 2");
  assert.deepEqual(confident.writes[0].reasons, ["model-judged"], "the judged row carries the model-judged chip");
  assert.deepEqual(confident.published, [{ event: "inbox-changed", payload: { bumped: 1 } }], "promotion publishes for reload");

  const unsure = bumpHarness({ noul: 0.3 });
  await createSeverityBump(unsure.ctx).maybeBumpSeverity();
  assert.ok(!unsure.writes[0].sql.includes("SET severity = 2"), "low confidence keeps the tier");
  assert.ok(!/SET severity = [01]/.test(unsure.writes[0].sql), "no write ever demotes a tier");
  assert.ok(!unsure.writes[0].sql.includes("resolved_at ="), "the bump never resolves anything");
  assert.ok(!unsure.writes[0].sql.includes("archived_at ="), "the bump never archives anything");
  assert.deepEqual(unsure.writes[0].reasons, ["model-judged"], "even a kept tier is tagged, so re-judgment terminates");
}

// Bounded: five settled candidates still judge at most three.
{
  const rows = ["ev_1", "ev_2", "ev_3", "ev_4", "ev_5"].map((id) => ({
    id, summary: "stuck", severity_reasons: null, display_name: "C", name: "C", card_kind: "build", stage: "shape",
  }));
  const many = bumpHarness({ rows });
  many.ctx.db.prepare = (sql) => ({
    all: () => (sql.includes("FROM inbox_events") ? rows.slice(0, 3) : []),
    run: () => ({ changes: 1 }),
  });
  await createSeverityBump(many.ctx).maybeBumpSeverity();
  assert.equal(many.judgments(), 3, "at most three judgments per sweep");
}

// Kill-switch and mode gates: disabled or non-api modes skip the sweep
// silently, leaving deterministic tiers standing.
{
  assert.equal(isDecisionApiDisabled({ STELOW_DECISION_API: "0" }), true, "the kill switch reads the operator variable");
  assert.equal(isDecisionApiDisabled({}), false, "unset means enabled");
  const rules = bumpHarness({ mode: "rules" });
  await createSeverityBump(rules.ctx).maybeBumpSeverity();
  assert.equal(rules.judgments(), 0, "rules mode never calls out");
  assert.equal(rules.published.length, 0, "a skipped sweep publishes nothing");
  const before = process.env.STELOW_DECISION_API;
  process.env.STELOW_DECISION_API = "0";
  try {
    const killed = bumpHarness({ mode: "api" });
    await createSeverityBump(killed.ctx).maybeBumpSeverity();
    assert.equal(killed.judgments(), 0, "the kill switch covers the bump");
  } finally {
    if (before === undefined) delete process.env.STELOW_DECISION_API;
    else process.env.STELOW_DECISION_API = before;
  }
}

console.log("inbox severity bump test ok: bump-only 1-2 capped at 3 with tag, never demotes");
