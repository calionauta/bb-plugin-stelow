import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyGapTotals,
  escalationRate,
  formatGapTotals,
  formatRate,
} from "../lib/metrics-format.mjs";
import { formatTokenUsage, sumTokenBreakdowns, tokenBreakdownFromEvents, tokenUsageFromEvents, totalTokenUsage } from "../lib/token-usage.mjs";
import { excerptMetricLine, summarizeExcerpts } from "../lib/review-truncation.mjs";
import { shareOf, splitWaitWindows, unionLengthMs } from "../lib/wait-attribution.mjs";

/**
 * The metric contract: what each number means, what direction is better, and
 * that an absent measurement is never a zero.
 *
 * This file exists for a reason outside the product. Metrics are about to be
 * used as an optimization target — an experiment loop is going to be asked to
 * make prompts smaller and cards faster — and a loop optimizes whatever the
 * metric does. A metric whose definition can be quietly changed is a metric the
 * loop can satisfy by redefining rather than improving: `promptChars` that stops
 * counting the boilerplate, `escalationRate` that returns 0 instead of null for
 * a card with no findings, a wait share that reads 100% because the union
 * silently became a sum.
 *
 * So every metric this suite reports is pinned here: its direction, its null
 * rule, and its unit. This is the file that has to fail when a target is
 * redefined. The definitions themselves live in `lib/` and are not restated —
 * only their contract is.
 */

const METRIC_CONTRACT = [
  {
    name: "escalationRate",
    direction: "lower-is-better",
    unit: "ratio",
    // Null when there were no findings: a card with no gaps has no rate, and
    // printing 0% claims a measurement nobody took.
    nullsWhen: "no findings",
    probe: () => escalationRate(emptyGapTotals()),
    expectNull: true,
  },
  {
    name: "escalationRate(measured)",
    direction: "lower-is-better",
    unit: "ratio",
    nullsWhen: "never, once findings exist",
    probe: () => escalationRate({ total: 4, fixed: 1, documented: 2, escalated: 1 }),
    expect: 0.25,
  },
  {
    name: "tokenUsageFromEvents",
    direction: "informational",
    unit: "tokens",
    // The provider's number or nothing. A missing report is unknown, and an
    // unknown rendered as 0 makes a card look free.
    nullsWhen: "no provider report",
    probe: () => tokenUsageFromEvents([]),
    expectNull: true,
  },
  {
    name: "totalTokenUsage",
    direction: "lower-is-better",
    unit: "tokens",
    nullsWhen: "every thread unknown",
    probe: () => totalTokenUsage([{ tokenUsage: null }]),
    expectNull: true,
  },
  {
    name: "totalTokenUsage(measured)",
    direction: "lower-is-better",
    unit: "tokens",
    nullsWhen: "never, once any thread reported",
    probe: () => totalTokenUsage([{ tokenUsage: 100 }, { children: [{ tokenUsage: 25 }] }]),
    expect: 125,
  },
];

// --- 1. Every metric declares its direction and its null rule. --------------
for (const metric of METRIC_CONTRACT) {
  assert.ok(metric.name, "a metric has a name");
  assert.ok(["lower-is-better", "higher-is-better", "informational"].includes(metric.direction), `${metric.name} declares a direction`);
  assert.ok(metric.unit, `${metric.name} declares a unit`);
  assert.ok(metric.nullsWhen, `${metric.name} declares when absence is null rather than zero`);
  const value = metric.probe();
  if (metric.expectNull) {
    assert.equal(value, null, `${metric.name} resolves null (${metric.nullsWhen})`);
  } else {
    assert.equal(value, metric.expect, `${metric.name} keeps its pinned value`);
  }
}

// --- 2. Null and zero are different answers, everywhere. --------------------
// The single rule the whole metrics stack is built on. Stated once per module so
// a new metric cannot be added with the other convention.
assert.equal(escalationRate(emptyGapTotals()), null, "no findings is null, not 0");
assert.equal(formatRate(null), "n/a", "an unmeasured rate reads n/a, never 0%");
assert.equal(formatRate(0), "0%", "a measured zero reads 0%, which is a different answer");
assert.equal(formatGapTotals(emptyGapTotals()).includes("n/a"), true, "the printed total does not invent a rate for a card with no gaps");

assert.equal(
  tokenUsageFromEvents([{ type: "thread/tokenUsage/updated", data: { tokenUsage: { total: { totalTokens: 0 } } } }]),
  0,
  "a measured zero total survives",
);
assert.equal(formatTokenUsage(0), "0", "a measured zero formats as 0, not as absent");
assert.equal(formatTokenUsage(null), null, "an absent total formats as nothing");

// The split legs follow the same rule per leg: cached is the sum of both cache
// fields, and a leg the provider omitted stays null rather than becoming 0.
assert.deepEqual(
  tokenBreakdownFromEvents([{ type: "thread/tokenUsage/updated", data: { tokenUsage: { total: { inputTokens: 10, totalTokens: 10 } } } }]),
  { input: 10, output: null, cached: null, reasoning: null, total: 10 },
  "omitted legs are null, not zero — a partial report never fabricates the missing half",
);
assert.deepEqual(
  sumTokenBreakdowns([{ input: 5, output: null, total: 5 }, { input: 7, output: 3, total: 10 }]),
  { input: 12, output: 3, cached: null, reasoning: null, total: 15 },
  "per-leg sums keep legs nobody reported as null",
);

// --- 3. Review truncation counts how, not just whether. ---------------------
// The count an operator acts on is `headCuts`: a document cut to its opening may
// have hidden a required section, where a cut to the contract's own sections did
// not. Averaging them into one "truncated" count makes the actionable signal
// disappear, which is the failure this metric was built to avoid.
//
// Pinned to exact values, not to `typeof === "number"`. That was the first version
// and an adversarial review was right to call it inert: `typeof 0 === "number"`,
// so the whole block passed on an empty fixture and would have passed with
// `headCuts` folded into `truncated` — the exact failure this file's own docstring
// names. A count assertion that any count satisfies is not an assertion.
const fleet = summarizeExcerpts([
  { excerpt: { selected: "whole", truncated: false, sentChars: 100, originalChars: 100 } },
  { excerpt: { selected: "contract", truncated: true, sentChars: 200, originalChars: 900 } },
  { excerpt: { selected: "head", truncated: true, sentChars: 200, originalChars: 900 } },
  { excerpt: { selected: "head", truncated: true, sentChars: 50, originalChars: 900 } },
]);
assert.deepEqual(
  { counted: fleet.counted, truncated: fleet.truncated, headCuts: fleet.headCuts },
  { counted: 4, truncated: 3, headCuts: 2 },
  "the three counts are exact: a head cut is a cut, but not every cut is a head cut",
);
assert.deepEqual(
  fleet.byMode,
  { whole: 1, contract: 1, head: 2 },
  "the mode breakdown counts how each cut was made, so the reassuring and worrying readings stay distinguishable",
);
// The distinction that makes the count actionable, asserted on the two fleet
// shapes that differ only in how the cut was made.
const contractsOnly = summarizeExcerpts([
  { excerpt: { selected: "contract", truncated: true, sentChars: 200, originalChars: 900 } },
]);
assert.equal(contractsOnly.truncated, 1, "a contract cut is a truncation");
assert.equal(contractsOnly.headCuts, 0, "a contract cut is NOT a head cut — folding the two together destroys the signal");
assert.match(excerptMetricLine(contractsOnly), /all cuts kept the contract's sections/, "the reassuring reading is its own sentence");
assert.match(excerptMetricLine(fleet), /2 read only the opening/, "the worrying reading names its own count");
assert.equal(summarizeExcerpts([]).counted, 0, "no reviews counts zero records, which is not the same as zero truncations");
assert.equal(excerptMetricLine(summarizeExcerpts([])), "", "a fleet that never truncated says nothing rather than 0 of 0");

// --- 4. Wait time is a union, not a sum. ------------------------------------
// The share metric exists to answer "how much of this card's time was a
// person's". Summing overlapping windows reports shares above 100%, which is the
// specific way this number lies — and the way an optimization loop would "win"
// by double-counting.
const HOUR = 3_600_000;
const overlapping = splitWaitWindows({
  startAt: 0,
  endAt: HOUR,
  windows: [
    { kind: "paused", start: 0, end: HOUR },
    { kind: "question", start: 0, end: HOUR },
  ],
});
assert.equal(overlapping.totalMs, HOUR, "two windows covering the same hour is one hour");
const share = shareOf(overlapping.humanMs, overlapping.totalMs);
assert.ok(share <= 1, `a wait share never exceeds 100% (got ${share})`);
assert.equal(unionLengthMs([{ start: 0, end: HOUR }, { start: 0, end: HOUR }]), HOUR, "the union of identical intervals is one interval");
assert.equal(unionLengthMs([]), 0, "no windows is zero millis of union, which is a real measurement of an empty set");

// --- 5. Every metric owner is inside the contract, or named as outside it. ----
// The enumeration above is hand-written, and a hand-written list is a promise: a
// new `lib/*-metrics.mjs` would sit outside the contract with nothing noticing,
// which is how the two owners below came to be unguarded in the first place. This
// is a discovery guard, not a coverage claim — a module that joins the list must
// have been looked at and decided about.
const METRIC_OWNERS_IN_CONTRACT = new Set([
  "lib/metrics-format.mjs",
  "lib/token-usage.mjs",
  "lib/review-truncation.mjs",
  "lib/wait-attribution.mjs",
]);
const METRIC_OWNERS_OUTSIDE = new Map([
  [
    "lib/card-metrics.mjs",
    "lead/cycle time from the stage ledger — nothing here returns a rate or a share, so the null-vs-zero rule does not apply; its own tests pin the sums",
  ],
  [
    "lib/rework-metrics.mjs",
    "the rework rate — it deliberately resolves null for a single-round card, and its own test pins that; listed here so it is a decision, not an oversight",
  ],
]);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const metricModules = readdirSync(join(root, "lib"))
  .filter((name) => /metric|token-usage|wait-attribution|review-truncation/.test(name) && name.endsWith(".mjs"))
  .map((name) => `lib/${name}`)
  .sort();
assert.ok(metricModules.length >= 5, `the metric-module scan found the owners (got ${metricModules.length})`);
const uncovered = metricModules.filter((file) => !METRIC_OWNERS_IN_CONTRACT.has(file) && !METRIC_OWNERS_OUTSIDE.has(file));
assert.deepEqual(
  uncovered,
  [],
  `every module owning a metric is either in this contract or named as deliberately outside it. Unaccounted: ${uncovered.join(", ")}`,
);
const stale = [...METRIC_OWNERS_IN_CONTRACT, ...METRIC_OWNERS_OUTSIDE.keys()].filter((file) => !metricModules.includes(file));
assert.deepEqual(stale, [], `a named owner whose module is gone is a stale decision: ${stale.join(", ")}`);

console.log(
  `metrics contract ok: ${METRIC_CONTRACT.length} metrics pinned ` +
    `(direction, unit, null-vs-zero) · wait share stays a union`,
);
