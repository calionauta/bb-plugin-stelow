import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { meetsDecisionThreshold } from "../lib/decision-api.mjs";
import { getDecisionPoint, severityBumpQuestions } from "../lib/decision-points.mjs";
import { parseSeverityReasons } from "../lib/inbox-severity.mjs";

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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The severity sweep is its own module: the decision API has several seams, and
// these bounds belong to the one that re-judges inbox items.
const seams = readFileSync(join(root, "server", "decision-severity.ts"), "utf8");

// Scope bounds: only open severity-1 items older than 5 minutes, at most 3
// per sweep, never re-judging a checked item. Widening any bound fails here.
// The query is one statement split across joined lines, so each bound is pinned
// where the module states it, table-qualified.
assert.match(
  seams,
  /WHERE inbox_events\.resolved_at IS NULL AND inbox_events\.archived_at IS NULL/,
  "the bump reads open routine items only — escalations and closed rows are out of scope",
);
assert.match(seams, /AND inbox_events\.severity = 1/, "only routine severity-1 items are re-judged");
assert.match(
  seams,
  /AND inbox_events\.occurred_at <= \?[\s\S]*NOT LIKE '%model-judged%'/,
  "fresh items settle and checked items never re-judge",
);
assert.match(seams, /ORDER BY inbox_events\.occurred_at ASC LIMIT 3/, "at most three judgments per sweep, oldest first");
assert.match(seams, /5 \* 60 \* 1000/, "the 5-minute settle window is pinned");

// Promotion-only: the seam's only severity write escalates 1 to 2. A
// regression that demotes (SET severity = 0/1), resolves (resolved_at =),
// or archives fails here.
const bumpFile = seams;
assert.ok(bumpFile.includes("SET severity = 2"), "promotion escalates to 2");
assert.ok(!/SET severity = [01]/.test(bumpFile), "no write ever demotes a tier");
assert.ok(!bumpFile.includes("resolved_at ="), "the bump never resolves anything");
assert.ok(!bumpFile.includes("archived_at ="), "the bump never archives anything");

// Every judged row is tagged model-judged (promoted or not), so the
// NOT LIKE guard above actually terminates re-judgment.
assert.ok(bumpFile.includes('"model-judged"'), "judged rows carry the model-judged chip");

// Kill-switch and mode gates: disabled or non-api modes skip the sweep
// silently, leaving deterministic tiers standing.
assert.ok(bumpFile.includes("isDecisionApiDisabled(process.env)"), "the kill switch covers the bump");
assert.ok(bumpFile.includes('normalizePointMode(point?.mode, "rules")'), "the mode is read from the stored point");
assert.ok(bumpFile.includes('if (mode !== "api" || isDecisionApiDisabled(process.env)) return;'), "rules mode never calls out");
assert.ok(bumpFile.includes("inbox severity ignores preset mode"), "preset mode is refused on the hot path with the cost reason");

// The bump publishes for reload when it promotes — and only then.
assert.match(seams, /inbox-changed", \{ bumped:/, "promotion publishes for reload");

console.log("inbox severity bump test ok: bump-only 1-2 capped at 3 with tag, never demotes");
