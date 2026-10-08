import assert from "node:assert/strict";
import test from "node:test";
import { reviewCoversFingerprint } from "../lib/review-verdict.mjs";
import {
  callsNamed,
  cliHarness,
  commentBodies,
} from "./helpers/cli-harness.mjs";

/** The full review chain with a real dispatcher: CLI → subject → parser →
 * record file → done-gate reader. A contradictory pass must be recorded as
 * human-review and cover nothing; a clean pass must be recorded as pass
 * and cover. Either half failing means the chain is broken, not the unit. */
const TECH_PLAN = [
  "## Identified Scopes",
  "The payment retry path and the receipt renderer are the two scopes. ".repeat(
    60,
  ),
  "",
  "## Sequence",
  "Retry first, then the receipt. ".repeat(60),
  "",
  "| Task | Done Criterion | Dependencies |",
  "| --- | --- | --- |",
  "| Retry path | Retry test passes | none |",
  "| Receipt | Receipt renders the retry | Retry path |",
  "",
].join("\n");

const FILES = {
  "/w/.stelow/state/state.md":
    "artifacts:\n  - stage: plan\n    kind: document\n    label: tech plan\n    path: spec-tech.md\n",
  "/w/spec-tech.md": TECH_PLAN,
};

function reviewerOutput(verdict, findingVerdict) {
  const finding = {
    criterion: "scope fits request",
    quote: "## Sequence",
    verdict: findingVerdict,
    repair: findingVerdict === "FAIL" ? "narrow the sequence" : "none",
  };
  return `\`\`\`json\n${JSON.stringify({ verdict, findings: [finding] })}\n\`\`\``;
}

function writtenReviews(calls) {
  return callsNamed(calls, "write")
    .map(([, payload]) => payload?.content ?? "")
    .filter((content) => content.includes("# Review "));
}

test("a contradictory pass is recorded as human-review and covers nothing", async () => {
  const { invoke, calls } = cliHarness({
    reviewPresetId: "preset_rev",
    reviewerOutput: reviewerOutput("pass", "FAIL"),
    files: FILES,
  });
  const result = await invoke(["review", "--artifact", "spec-tech.md"]);
  assert.equal(result.exitCode, 0);
  const records = writtenReviews(calls);
  assert.equal(records.length, 1, "one durable review record");
  assert.match(records[0], /^Status: human-review$/m, "record carries the degraded status");
  assert.match(
    commentBodies(calls).join("\n"),
    /Contradictory pass discarded/,
    "card comment names the discard",
  );
  assert.equal(
    reviewCoversFingerprint([{ name: "review.md", content: records[0] }], "none"),
    false,
    "thrown-out approval never covers the done gate",
  );
});

test("a clean pass is recorded as pass and still covers", async () => {
  const { invoke, calls } = cliHarness({
    reviewPresetId: "preset_rev",
    reviewerOutput: reviewerOutput("pass", "PASS"),
    files: FILES,
  });
  const result = await invoke(["review", "--artifact", "spec-tech.md"]);
  assert.equal(result.exitCode, 0);
  const records = writtenReviews(calls);
  assert.equal(records.length, 1, "one durable review record");
  assert.match(records[0], /^Status: pass$/m, "record carries the pass");
  assert.equal(
    reviewCoversFingerprint([{ name: "review.md", content: records[0] }], "none"),
    true,
    "clean pass still covers its fingerprint",
  );
});
