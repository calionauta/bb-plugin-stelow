import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sealStatus, validateArtifact } from "../lib/artifact-validation.mjs";
import {
  CRITERIA_MET_SCORE,
  CRITERIA_UNMET_SCORE,
  judgeArtifactCriteria,
} from "../lib/skill-criteria.mjs";

// Artifact-criteria judge: semantic scoring only inside the unselected-gate
// judgment; gate predicates and sealStatus stay deterministic. One atomic
// Score per criterion; below-floor confidence or API failure reads
// unverifiable, never verified. A validateArtifact failure refuses the gate
// with a needs-revision redirect — model output never advances anything.

const SKILL = `criteria:
  - id: dangers-quality
    kind: semantic
    text: "Dangers name concrete failure modes with triggers"
  - id: tradeoff-quality
    kind: semantic
    text: "Trade-offs state explicit sacrifices"`;

// A stub provider keyed off the request body: it scores high only when the
// state carries the artifact's keyword AND the question quotes the
// criterion. Inverting either input must flip the verdict — proving the
// judgment reads both, not a hardcoded answer.
const keywordFetch = (keyword) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const id = Object.keys(body.questions)[0];
  const instructions = body.questions[id]?.instructions ?? "";
  const hit = body.state.includes(keyword) && instructions.includes(keyword);
  return {
    status: 200,
    json: async () => ({ answers: { [id]: { type: "score", score: hit ? 1.9 : 0.1, confidence: 0.9 } } }),
  };
};
const triggerSkill = `criteria:
  - id: dangers-quality
    kind: semantic
    text: "names concrete outage trigger"`;
const seenBodies = [];
const spyingFetch = (keyword) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  seenBodies.push(body);
  return keywordFetch(keyword)(url, opts);
};
const spied = await judgeArtifactCriteria({
  provider: "jev",
  endpoint: "https://judge.test/v1",
  apiKey: "k",
  model: "m",
  skillText: SKILL,
  artifactText: "outage trigger: disk-full halts writes",
  routeAt: 0.6,
  fetchImpl: spyingFetch("disk-full"),
});
assert.equal(seenBodies.length, 2, "one atomic call per semantic criterion, never batched");
assert.ok(seenBodies.every((body) => Object.keys(body.questions).length === 1), "each call carries exactly one question");
assert.ok(seenBodies.every((body) => body.state.includes("disk-full")), "every call carries the artifact excerpt as state");
const quoted = seenBodies.map((body) => Object.values(body.questions)[0].instructions).join("\n");
assert.ok(quoted.includes("concrete failure modes"), "the first question quotes its criterion");
assert.ok(quoted.includes("explicit sacrifices"), "the second question quotes its criterion");
const hitCall = await judgeArtifactCriteria({
  provider: "jev",
  endpoint: "https://judge.test/v1",
  apiKey: "k",
  model: "m",
  skillText: triggerSkill,
  artifactText: "names concrete outage trigger in the deploy notes",
  routeAt: 0.6,
  fetchImpl: keywordFetch("trigger"),
});
assert.equal(hitCall.findings[0].verdict, "met", "criterion quoted and artifact evidenced reads met");

// Invert the artifact: same criterion, evidence removed — the verdict must
// flip to unmet. A judge that cannot fail on inverted evidence is decoration.
const inverted = await judgeArtifactCriteria({
  provider: "jev",
  endpoint: "https://judge.test/v1",
  apiKey: "k",
  model: "m",
  skillText: triggerSkill,
  artifactText: "some unrelated prose about velocity",
  routeAt: 0.6,
  fetchImpl: keywordFetch("trigger"),
});
assert.equal(inverted.findings[0].verdict, "unmet", "removing the evidence flips met to unmet");

// Judge disabled (no fetch implementation / dead provider) yields
// unverifiable across the board — never verified, never a throw.
const dead = await judgeArtifactCriteria({
  provider: "jev",
  endpoint: "https://judge.test/v1",
  apiKey: "k",
  model: "m",
  skillText: triggerSkill,
  artifactText: "names concrete outage trigger",
  routeAt: 0.6,
  fetchImpl: async () => { throw new Error("down"); },
});
assert.equal(dead.ok, false, "total provider failure degrades the call");
assert.ok(dead.findings.every((finding) => finding.verdict === "unverifiable"), "a dead judge abstains on every criterion");
const noFetch = await judgeArtifactCriteria({
  provider: "jev",
  endpoint: "https://judge.test/v1",
  apiKey: "k",
  model: "m",
  skillText: triggerSkill,
  artifactText: "names concrete outage trigger",
  routeAt: 0.6,
  fetchImpl: undefined,
});
assert.ok(noFetch.findings.every((finding) => finding.verdict === "unverifiable"), "no judge implementation abstains, never verifies");

// Cutoffs stay pinned: removing the judge module's floors would silently
// regrade every past verdict.
assert.equal(CRITERIA_MET_SCORE, 1.5, "met floor is pinned");
assert.equal(CRITERIA_UNMET_SCORE, 0.5, "unmet ceiling is pinned");

// Deterministic gates stay authoritative: a thin artifact fails
// validateArtifact, and sealStatus maps that failure to needs-revision —
// the gate refuses with a redirect, never advances on model output.
const thin = validateArtifact("thin prose", { minWords: 50 });
assert.equal(thin.pass, false, "a thin artifact fails deterministically");
assert.equal(sealStatus({ pass: false }, "verified"), "needs-revision", "gate failure seals needs-revision");
assert.equal(sealStatus({ pass: true }, "verified"), "verified", "a passing gate still seals verified");
assert.equal(sealStatus(null, "verified"), "unverified", "no validation reads unverified, never verified");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
assert.ok(server.includes('verdict: ran.ok ? "met" : "unmet"'), "verify-command verdicts stay deterministic (exit 0 reads met)");
assert.ok(!/judgeArtifactCriteria\(\{[^}]*advance/.test(server), "the criteria judge never reaches an advance path");

console.log("artifact criteria judge test ok: inversion fails, disabled abstains, gates stay deterministic");
