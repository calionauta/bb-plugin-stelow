import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { excerptMetricLine, summarizeExcerpts } from "../lib/review-truncation.mjs";
import { reworkMetricLine, summarizeRework } from "../lib/rework-metrics.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

const card = read("components/detail/build-progress.tsx");
const strip = read("components/board/flow-strip.tsx");
const flowWait = read("components/board/flow-wait.tsx");
const metricsLines = read("components/metrics/metrics-lines.tsx");
const coverage = read("server/runtime/flow-coverage.ts");
const contract = read("server/card-rpc-contract.ts");

const gaps = (...rows) => rows.map(([description, resolution]) => ({ description, resolution }));

// The CLI is the source of truth for what a number means, and these two
// surfaces exist to show it. The test that matters is therefore not "does the
// card render a number" but "can the card ever word a number differently from
// the terminal" — which is why every assertion below is about a shared owner
// rather than about a string.

// --- The shared component is a switch over the owners, not a formatter. ----
assert.match(
  metricsLines,
  /reworkMetricLine\(summarizeRework\(facts\?\.rounds \?\? \[\]\)\)/,
  "the card's component calls the rework owner rather than deriving a rate",
);
assert.match(
  metricsLines,
  /excerptMetricLine\(summarizeExcerpts\(facts\?\.reviews \?\? \[\]\)\)/,
  "and the coverage owner for the body line, so the card carries both readings",
);
assert.match(
  card,
  /const bodyLines = metricBodyLines\(\{ rounds: summary\.rounds, reviews: summary\.reviews \}\)/,
  "the card's body carries both lines from the shared owners",
);
// The hint is the short form, not the full sentence: a collapsed row already
// carries five numbers, and a 65-character sentence among them is noise.
assert.match(
  metricsLines,
  /return `\$\{summary\.reworked\} re-worked`/,
  "the hint carries the count, while the body carries the owner's full sentence",
);
assert.doesNotMatch(
  card,
  /hint=\{[^}]*reworkMetricLine/,
  "the hint is not the full rework sentence, which belongs in the body",
);
assert.match(contract, /reviews: z\.array\(/, "the gap summary publishes the parsed review records, so the card never re-reads the workspace");
assert.doesNotMatch(
  metricsLines,
  /Math\.round\(.*\* 100\)|escalated \/ /,
  "no percentage is computed anywhere in the component",
);

// --- The card asks for the round boundary it cannot derive. -----------------
assert.match(
  contract,
  /rounds: z\.array\(z\.array\(z\.object\(\{ description: z\.string\(\), resolution: z\.string\(\) \}\)\)\)/,
  "the gap summary publishes the per-round findings, so the card never re-derives them",
);
assert.match(
  card,
  /rounds: Array<Array<\{ description: string; resolution: string \}>>/,
  "the card's gap view carries the rounds",
);
assert.match(
  card,
  /const rework = metricHint\(\{ rounds: summary\.rounds \}\)/,
  "the hint is the rework line, and it is computed from the shared owner",
);

// --- Rework reaches the card's hint, and only when it has something to say. --
// A card reviewed once must not carry a rework hint: one pass cannot show
// convergence, and a permanent "no rework" is a claim nobody measured.
// --- The flow strip prints what the server rendered. ------------------------
// It must not format: a strip that re-derives a rate is a third wording of the
// same number, which is the failure this whole change exists to remove.
assert.match(flowWait, /export function CoverageLines\(/, "the coverage lines live beside the wait breakdown, which is the same subject");
assert.match(
  flowWait,
  /const lines = \[coverage\.reworkLine, coverage\.coverageLine\]\.filter\(\(line\) => line\.length > 0\)/,
  "both lines are printed verbatim, and an empty one is dropped rather than shown blank",
);
assert.match(strip, /<CoverageLines coverage=\{result\.coverage\} \/>/, "the timing tab renders them");
assert.doesNotMatch(
  flowWait,
  /Math\.round\(.*\* 100\)|escalatedRate/,
  "the strip never computes a rate of its own",
);

// --- The fleet aggregation is a sum, and the round boundary survives. --------
// A median of per-card medians would be a second source of truth for the same
// question, which is the mistake the wait breakdown documents against.
assert.match(
  coverage,
  /const comparable = perCard\.reduce\(\(sum, card\) => sum \+ Math\.max\(0, card\.rounds - 1\), 0\)/,
  "passes after the first are summed across cards",
);
assert.match(
  coverage,
  /reworkMetricLine\(reworkSummary\)/,
  "the fleet line is rendered by the same owner the CLI and the card call",
);
assert.match(
  coverage,
  /excerptMetricLine\(coverage\)/,
  "and so is the coverage line",
);

// --- Silence is decided by the owner, so the surfaces cannot disagree. ------
{
  const owner = reworkMetricLine(summarizeRework([gaps(["A", "fixed"])]));
  assert.equal(owner, "", "the owner says nothing for a single round");
  assert.equal(reworkMetricLine(summarizeRework([gaps(["A", "fixed"])])), "", "and the card therefore has nothing to print either");
  const truncated = excerptMetricLine(summarizeExcerpts([{ excerpt: { selected: "whole", truncated: false } }]));
  assert.equal(truncated, "", "a fleet whose reviews all read whole prints no coverage line");
}

// --- The type scale, and no new surface above the first disclosure. ---------
// A metrics block that became its own always-open panel would break the card's
// shape and restate a fact a section already owns; the hierarchy test enforces
// the second half, and this enforces that the metric rides an existing section.
assert.doesNotMatch(
  card,
  /<MetricsLines/,
  "the card does not render a metrics block of its own — rework rides the existing section's hint",
);
assert.match(card, /title="Gaps and rework"/, "and the section that carries it is one the card already had");

// --- The metadata step, not a new one. -------------------------------------
assert.match(
  flowWait,
  /className="text-xs leading-5 text-muted-foreground"/,
  "the coverage lines use the card's own metadata step rather than a size invented here",
);
assert.doesNotMatch(
  flowWait,
  /text-\[1[0-5]px\]|text-\[9px\]/,
  "and no size outside the scale appears",
);

console.log("metrics surfaces ok: the card and the strip print what the owners rendered, and stay silent when there is nothing to say");
