import assert from "node:assert/strict";
import { buildReviewPrompt, extractJsonBlock, parseReviewOutput, reviewSummary, reviewCoversFingerprint, MAX_REVIEW_CHARS } from "../lib/review-verdict.mjs";

const ARTIFACT = "## Top 10:\n#### 1/10 Ensure outcome one\n- Alternative: achieve result one\n";

// Prompt carries the contract, the request, and the truncation note.
const prompt = buildReviewPrompt({
  cardName: "Card",
  request: "Map jobs",
  contractLabel: "functional-needs: 10 criteria",
  artifactContent: ARTIFACT,
  deterministicFailures: [],
  evidence: "verified",
});
assert.match(prompt, /functional-needs: 10 criteria/, "prompt names the contract");
assert.match(prompt, /Map jobs/, "prompt names the request");
assert.match(prompt, /verbatim/, "prompt demands quotes");
assert.ok(!prompt.includes("truncated"), "short artifact carries no truncation note");
const longPrompt = buildReviewPrompt({ cardName: "C", request: "R", contractLabel: "L", artifactContent: "x".repeat(MAX_REVIEW_CHARS + 1) });
assert.match(longPrompt, /truncated/, "long artifact is marked truncated");
const hypoPrompt = buildReviewPrompt({ cardName: "C", request: "R", contractLabel: "L", artifactContent: "x", evidence: "hypothesis-only" });
assert.match(hypoPrompt, /do not penalize missing external sources/, "hypothesis-only adjusts the rubric");

// Valid verdict with an exact quote passes; fabricated quotes drop the finding.
const good = '```json\n{"verdict": "needs-revision", "findings": [{"criterion": "scope fits", "quote": "#### 1/10 Ensure outcome one", "verdict": "FAIL", "repair": "add metrics"}]}\n```';
const parsed = parseReviewOutput(good, ARTIFACT);
assert.equal(parsed.status, "needs-revision", "verdict kept");
assert.equal(parsed.findings.length, 1, "exact quote kept");
assert.equal(parsed.dropped, 0, "nothing dropped");
const forged = '```json\n{"verdict": "pass", "findings": [{"criterion": "scope fits", "quote": "a sentence never written", "verdict": "PASS", "repair": "none"}]}\n```';
const forgedParsed = parseReviewOutput(forged, ARTIFACT);
assert.equal(forgedParsed.findings.length, 0, "fabricated quote dropped");
assert.equal(forgedParsed.dropped, 1, "drop counted");
assert.equal(forgedParsed.status, "pass", "status survives dropped findings");

// Malformed output degrades to human-review, never throws.
assert.equal(parseReviewOutput("no json here", ARTIFACT).status, "human-review", "missing block is human-review");
assert.equal(parseReviewOutput("```json\nnot json\n```", ARTIFACT).status, "human-review", "bad json is human-review");
assert.equal(parseReviewOutput('```json\n{"verdict": "superb"}\n```', ARTIFACT).status, "human-review", "unknown verdict is human-review");
assert.equal(extractJsonBlock("nothing"), null, "no block is null");

// Summary names verdict, counts, and drops.
assert.match(reviewSummary(parsed), /needs-revision.*1 finding\(s\), 1 failing/, "summary counts");
assert.match(reviewSummary(forgedParsed), /1 finding\(s\) dropped/, "summary names drops");

// Policy gate: only a passing review stamped with this fingerprint counts.
const reviews = [
  { name: "review-b.md", content: "Status: pass\nFingerprint: 3\n" },
  { name: "review-a.md", content: "Status: needs-revision\nFingerprint: 2\n" },
];
assert.equal(reviewCoversFingerprint(reviews, "3"), true, "passing review covers its fingerprint");
assert.equal(reviewCoversFingerprint(reviews, "2"), false, "failing review never covers");
assert.equal(reviewCoversFingerprint(reviews, "9"), false, "stale fingerprint is uncovered");
assert.equal(reviewCoversFingerprint([], "3"), false, "no reviews means uncovered");
assert.equal(reviewCoversFingerprint([{ name: "x.md", content: "free prose" }], "3"), false, "unshaped files never satisfy");

console.log("review verdict test ok: prompt shaping, quote verification, graceful degradation");
