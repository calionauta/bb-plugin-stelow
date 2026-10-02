import assert from "node:assert/strict";
import { cliHarness } from "./helpers/cli-harness.mjs";

// The counts themselves are pinned in tests/review-truncation.test.mjs, and the
// record format in tests/review-excerpt-record.test.mjs. What only this file can
// catch is the WIRING: a metric that is computed, formatted, and then never
// printed — or printed by --json while the text readout stays silent — would
// leave every other test green and the operator with nothing.

const reviewDoc = (excerptLine) => [
  "# Review 2026-10-02T01:00",
  "Card: Example",
  "Reviewer thread: thr_1",
  "Preset: Reviewer",
  "Status: pass",
  "Fingerprint: abc",
  excerptLine,
  "",
  "## Verdict",
].join("\n");

const harness = (reviewFiles) => cliHarness({ reviewFiles });

// --- A card whose reviews all read whole documents says nothing. -------------
{
  const { invoke, card } = harness([
    { name: "review-1.md", content: reviewDoc("Excerpt: whole, 800 of 800 chars, whole") },
  ]);
  const result = await invoke(["metrics", "--card", card.id]);
  assert.equal(result.exitCode, 0, "the readout still answers");
  assert.doesNotMatch(result.stdout, /Reviewer coverage/,
    "coverage nobody was cut on is silence, not a row of zeros");
}

// --- A cut review is named, with both numbers. ------------------------------
{
  const { invoke, card } = harness([
    { name: "review-1.md", content: reviewDoc("Excerpt: whole, 800 of 800 chars, whole") },
    { name: "review-2.md", content: reviewDoc("Excerpt: head, 12000 of 60000 chars, truncated") },
  ]);
  const result = await invoke(["metrics", "--card", card.id]);
  assert.match(result.stdout, /Reviewer coverage: 1 of 2 reviews read a cut artifact/,
    "the count and its denominator are both printed, so the number cannot be read as a rate");
  assert.match(result.stdout, /1 read only the opening/,
    "an opening cut is named, because it is the one that can have hidden a required section");
}

// --- A contract cut is the reassuring reading, and reads differently. -------
{
  const { invoke, card } = harness([
    { name: "review-1.md", content: reviewDoc("Excerpt: contract, 11000 of 40000 chars, truncated") },
  ]);
  const result = await invoke(["metrics", "--card", card.id]);
  assert.match(result.stdout, /all cuts kept the contract's sections/,
    "a cut that kept the contract's sections is not reported as a coverage failure");
}

// --- --json carries the same fact, not a second world. -----------------------
{
  const { invoke, card } = harness([
    { name: "review-1.md", content: reviewDoc("Excerpt: head, 12000 of 60000 chars, truncated") },
  ]);
  const result = await invoke(["metrics", "--card", card.id, "--json"]);
  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.reviewerCoverage,
    { counted: 1, truncated: 1, headCuts: 1, byMode: { whole: 0, contract: 0, head: 1 } },
    "--json reports the same counts the text line prints, including the zeroed modes",
  );
}

// --- A card with no reviews at all is not a failure. ------------------------
{
  const { invoke, card } = harness([]);
  const result = await invoke(["metrics", "--card", card.id]);
  assert.equal(result.exitCode, 0, "an unreviewed card still reports its timings");
  assert.doesNotMatch(result.stdout, /Reviewer coverage/, "and reports no coverage it never measured");
  const json = JSON.parse((await invoke(["metrics", "--card", card.id, "--json"])).stdout);
  assert.equal(json.reviewerCoverage.counted, 0, "zero counted is a real answer, distinct from absent");
}

console.log("reviewer coverage readout ok: a cut review is counted, named, and silent when there is nothing to count");
