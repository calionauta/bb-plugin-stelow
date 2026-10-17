import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { parseReviewOutput, reviewCoversFingerprint } from "../lib/review-verdict.mjs";

// Chain test: reviewer output → verdict → record → done-gate coverage.
// A contradictory pass must travel the whole chain as a non-covering
// human-review; a clean pass must still cover. The record format is exercised
// where writer and reader meet — the writer runs, its output is read back — so
// this cannot go green with the writer deleted (see
// review-excerpt-record.test.mjs for the counterpart).
const ARTIFACT = "## Outcome\n- The scope ships one slice\n";
const CONTRADICTORY = '```json\n{"verdict": "pass", "findings": ['
  + '{"criterion": "scope fits", "quote": "- The scope ships one slice",'
  + ' "verdict": "FAIL", "repair": "narrow scope"}]}\n```';
const CLEAN = '```json\n{"verdict": "pass", "findings": ['
  + '{"criterion": "scope fits", "quote": "- The scope ships one slice",'
  + ' "verdict": "PASS", "repair": "none"}]}\n```';

// The record status line is written by the real recorder, not by a copy of its// format here: `recordVerdict` runs against the CLI harness's deps, the file it
// hands the host is the file this test reads back. A record format that drifts
// from the writer therefore cannot stay green.
register(
  pathToFileURL(new URL("../tests/register-ts-source.mjs", import.meta.url).pathname),
  import.meta.url,
);
const { recordVerdict } = await import("../server/runtime/cli/cli-review-verdict.ts");
const { cliHarness } = await import("./helpers/cli-harness.mjs");

async function recordFor(output, fingerprint) {
  const { calls, deps, card } = cliHarness();
  await recordVerdict(
    deps,
    card,
    "thr_review",
    "Reviewer",
    { artifactText: ARTIFACT, fingerprint },
    output,
    "",
  );
  const written = calls.find(([entry]) => entry === "write");
  assert.ok(written, "the verdict is recorded on the card's own state dir");
  return written[1].content;
}

/** The machine-readable block a later review and the done gate read back. */
function verdictBlock(record) {
  const match = record.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(match, "the record carries the machine-readable verdict block");
  return JSON.parse(match[1]);
}

const thrown = parseReviewOutput(CONTRADICTORY, ARTIFACT);
const thrownRecord = await recordFor(CONTRADICTORY, "fp-1");
assert.match(thrownRecord, /^Status: human-review$/m, "the recorded status is the parsed status, verbatim");
assert.deepEqual(
  verdictBlock(thrownRecord),
  { status: thrown.status, findings: thrown.findings },
  "the record persists the parsed verdict, findings included",
);
const thrownFiles = [{ name: "review-a.md", content: thrownRecord }];
assert.equal(thrown.status, "human-review", "contradictory output parses as human-review");
assert.equal(reviewCoversFingerprint(thrownFiles, "fp-1"), false, "thrown-out approval never covers");

const clean = parseReviewOutput(CLEAN, ARTIFACT);
const cleanRecord = await recordFor(CLEAN, "fp-1");
assert.match(cleanRecord, /^Status: pass$/m, "a clean pass records its own status");
assert.deepEqual(
  verdictBlock(cleanRecord),
  { status: clean.status, findings: clean.findings },
  "a clean pass records the findings it parsed",
);
const cleanFiles = [{ name: "review-b.md", content: cleanRecord }];
assert.equal(clean.status, "pass", "clean pass parses as pass");
assert.equal(reviewCoversFingerprint(cleanFiles, "fp-1"), true, "clean pass still covers its fingerprint");
assert.equal(reviewCoversFingerprint(cleanFiles, "fp-2"), false, "stale fingerprint stays uncovered");

console.log("review contradiction gate ok: verdict travels verdict to record to gate");
