import assert from "node:assert/strict";
import {
  frontmatterBlock,
  parseGapFrontmatter,
  escalatedGaps,
  registryGaps,
  summarizeGaps,
  validateGapRegistry,
  gapsToTriageBatch,
  buildGapTriageState,
  normalizeGapEvidence,
  hasGapEvidence,
  GAP_TRIAGE_CRITIQUE_CHARS,
} from "../lib/gap-registry.mjs";
import { validateArtifact } from "../lib/artifact-validation.mjs";
import { contractForBuildArtifact } from "../lib/artifact-contracts.mjs";

const head = (gaps) => `---\ngaps:\n${gaps}\n---\n\n# Execution Critique Report\n\n## Summary\n\nWork reviewed.\n\n## Gap Registry\n\n| Gap Type | Description | Impact | Resolution |\n|---|---|---|---|\n| missing-tests | Login rate limiter | high | escalate |\n| typo | Fixed import | low | fixed |\n| debt | Rename helper | medium | documented |\n| auth | Session expiry | critical | escalate |\n\n## Lessons Learned\n\n- Keep going.\n\n## Decision\n\nTwo gaps escalate into new scopes.\n`;
const row = (type, impact, resolution, desc) =>
  `  - type: ${type}\n    area: "auth"\n    description: "${desc}"\n    impact: ${impact}\n    resolution: ${resolution}\n    scope_candidate: ${resolution.startsWith("escal")}`;
const fail = (result, code) => result.filter((f) => f.code === code);

const clean = head(`${row("missing-tests", "high", "escalate", "Login rate limiter")}
${row("quality", "low", "fixed", "Fixed import")}
${row("debt", "medium", "documented", "Rename helper")}
${row("new-scope", "critical", "escalate", "Session expiry")}`);

// Frontmatter extraction is fail-soft, never throws.
assert.equal(frontmatterBlock("no fences here"), null, "missing fences read as absent");
assert.equal(frontmatterBlock("---\nunclosed"), null, "unclosed fence reads as absent");

// Structured parse feeds the scope loop without re-reading prose.
const parsed = parseGapFrontmatter(clean);
assert.equal(parsed.found, true, "frontmatter found");
assert.equal(parsed.gaps.length, 4, "four gaps parsed");
assert.deepEqual(parseGapFrontmatter("# Report without frontmatter"), { found: false, gaps: [] }, "absent frontmatter parses empty");

// Only escalate rows become new scopes.
assert.deepEqual(escalatedGaps(clean).map((gap) => gap.description), ["Login rate limiter", "Session expiry"], "escalate rows selected");
assert.deepEqual(escalatedGaps("# no frontmatter"), [], "no frontmatter means no scopes");

// The card's list is the whole registry, not the escalated slice: a summary
// counting every finding has to be able to show every finding.
assert.deepEqual(
  registryGaps(clean).map((gap) => [gap.description, gap.resolution]),
  [
    ["Login rate limiter", "escalate"],
    ["Fixed import", "fixed"],
    ["Rename helper", "documented"],
    ["Session expiry", "escalate"],
  ],
  "every named row carries its disposition",
);
assert.deepEqual(registryGaps("# no frontmatter"), [], "no frontmatter means nothing to list");
assert.deepEqual(
  registryGaps(head("  - type: debt\n    impact: low\n    resolution: documented")),
  [],
  "a row with no description is a placeholder, not a finding",
);
assert.deepEqual(
  registryGaps(head(`${row("a", "low", "fixed", "Same gap")}\n${row("b", "low", "fixed", "Same gap")}`))
    .map((gap) => gap.description),
  ["Same gap"],
  "the same finding re-audited is one row, not two",
);
assert.deepEqual(
  registryGaps(head(row("a", "low", "escalated", "Spelled both ways"))).map((gap) => gap.resolution),
  ["escalate"],
  "the escalated spelling normalizes to one disposition",
);

// Summary drives the card UI and the escalated-rate metric.
assert.deepEqual(summarizeGaps(clean), { found: true, total: 4, fixed: 1, documented: 1, escalated: 2 }, "counts by resolution");

// The tally and the list must be ONE accounting. These used to disagree, and
// every disagreement is the reported symptom — "N gaps" above a shorter list:
//   placeholder row  -> total 1, listed 0
//   duplicate rows   -> total 2, listed 1
//   same gap re-audited in a second round -> totals summed, listed once
// `summarizeGaps` now derives from `registryGaps`, so these cannot drift.
const placeholder = head("  - just a finding with no fields");
assert.deepEqual(summarizeGaps(placeholder), { found: true, total: 0, fixed: 0, documented: 0, escalated: 0 },
  "a placeholder is not a finding, so it is not counted either");
assert.equal(summarizeGaps(placeholder).total, registryGaps(placeholder).length, "tally equals the list, always");

const duplicated = head(`${row("a", "low", "fixed", "Same gap")}\n${row("b", "low", "fixed", "Same gap")}`);
assert.equal(summarizeGaps(duplicated).total, 1, "a finding typed twice is one finding, in the tally too");
assert.equal(summarizeGaps(duplicated).total, registryGaps(duplicated).length, "and the list agrees");

// Round two re-audits the same finding. The caller SUMS per-critique totals
// (critique-gap-state), so the two accountings only agree if each is deduped
// and the caller dedupes too — which is the point: the header adds what the
// list cannot show, so it must add the same thing the list counts.
const sameGapRound2 = head(row("a", "medium", "documented", "Docs drifted"));
assert.equal(
  registryGaps(clean).length + registryGaps(sameGapRound2).length,
  summarizeGaps(clean).total + summarizeGaps(sameGapRound2).total,
  "each critique's tally equals its own list, so the caller can reconcile the sum",
);
assert.equal(summarizeGaps("# no frontmatter").found, false, "missing registry reported");

// A clean registry passes; an empty one passes (clean audit, no gaps).
assert.deepEqual(validateGapRegistry(clean), [], "clean registry passes");
assert.deepEqual(validateGapRegistry("---\ngaps: []\n---\n"), [], "empty registry passes");

// No frontmatter on a critique report blocks with the fix.
const missing = validateGapRegistry("# Execution Critique Report\n\nNo registry.");
assert.equal(missing.length, 1, "missing registry fails once");
assert.equal(missing[0].code, "gap-missing-frontmatter", "missing registry names its code");

// high/critical resolved as fixed or documented is a misclassification.
const misclassified = head(`${row("quality", "high", "fixed", "Skipped rate limit")}
${row("debt", "critical", "documented", "No session expiry")}`);
assert.deepEqual(fail(validateGapRegistry(misclassified), "gap-misclassified").length, 2, "both misclassifications fail");

// Rows without impact or resolution fail as incomplete, never silently pass.
const incomplete = head(`  - type: quality\n    area: "auth"\n    description: "Vague gap"\n    impact: unknown\n    resolution: later`);
assert.equal(fail(validateGapRegistry(incomplete), "gap-incomplete-row").length, 1, "unknown values fail as incomplete");

// Past-tense aliases read as their canonical resolution.
const aliased = head(`${row("quality", "low", "fixed", "A")}\n  - type: debt\n    area: "x"\n    description: "B"\n    impact: medium\n    resolution: documented`);
assert.deepEqual(validateGapRegistry(aliased), [], "aliases pass");

// Effort is fail-open when absent, checked when present.
const effortRow = (impact, effort, resolution) =>
  `---\ngaps:\n  - type: quality\n    area: "auth"\n    description: "Effort case"\n    impact: ${impact}\n${effort === null ? "" : `    effort: ${effort}\n`}    resolution: ${resolution}\n---\n`;
assert.deepEqual(validateGapRegistry(effortRow("medium", null, "fixed")), [], "absent effort skips effort checks");
assert.deepEqual(validateGapRegistry(effortRow("medium", "trivial", "fixed")), [], "medium trivial fixed passes");
assert.deepEqual(validateGapRegistry(effortRow("medium", "moderate", "documented")), [], "medium moderate documented passes");
assert.equal(fail(validateGapRegistry(effortRow("medium", "moderate", "fixed")), "gap-underfixed").length, 1, "medium moderate fixed fails as underfixed");
assert.equal(fail(validateGapRegistry(effortRow("medium", "significant", "fixed")), "gap-underfixed").length, 1, "medium significant fixed fails as underfixed");
assert.equal(fail(validateGapRegistry(effortRow("low", "huge", "fixed")), "gap-incomplete-row").length, 1, "unknown effort fails as incomplete");
assert.deepEqual(validateGapRegistry(effortRow("low", "significant", "escalate")), [], "over-disposition stays allowed");

// The execution-critique contract enforces the registry end to end.
const contract = contractForBuildArtifact("critiques/Execution Critique Report_v1.md", clean);
assert.ok(contract?.id === "execution-critique", "title routes to the critique contract");
assert.equal(validateArtifact(clean, contract).failures.filter((f) => f.code.startsWith("gap-")).length, 0, "clean critique has no registry failures");
const thin = validateArtifact("# Execution Critique Report\n\nThin prose.", contractForBuildArtifact("critiques/Execution Critique Report_v1.md", "# Execution Critique Report\n\nThin prose."));
assert.ok(thin.failures.some((f) => f.code === "gap-missing-frontmatter"), "thin critique fails on the registry");

// Gap triage batch: one atomic Score per escalated gap, ids synthesized
// once so questions and reported items cannot drift. The judge
// second-opinions genuineness only — routing stays deterministic.
const triage = gapsToTriageBatch([
  { description: "Missing rate-limit test" },
  { id: "g2", description: "Session expiry unhandled" },
  { description: "   " },
  null,
]);
assert.deepEqual(triage.items.map((item) => item.id), ["gap-1", "g2"], "synthesized ids join explicit ones");
assert.deepEqual(triage.items.map((item) => item.name), ["Missing rate-limit test", "Session expiry unhandled"], "the description is the reported name");
assert.deepEqual(Object.keys(triage.questions), ["gap:gap-1", "gap:g2"], "question keys mirror item ids");
assert.equal(triage.questions["gap:gap-1"].type, "score", "triaging is a Score judgment");
assert.ok(triage.questions["gap:g2"].instructions.includes("Session expiry unhandled"), "the gap reaches the judge");
assert.deepEqual(gapsToTriageBatch(null), { items: [], questions: {} }, "junk builds an empty batch");
assert.deepEqual(gapsToTriageBatch([null, { description: "" }]), { items: [], questions: {} }, "description-less gaps ask nothing");

// Genuineness cannot be judged from the gap's wording alone: the state
// carries the critique that claimed the gaps and the diff that shows
// whether the code still has them. Missing pieces degrade, never throw —
// a non-Git workspace still gets a judgment.
const state = buildGapTriageState({ critiqueText: "# Execution Critique Report\n\ngaps:\n  - description: Missing rate-limit test", diff: "diff --git a/x b/x\n+added" });
assert.ok(state.includes("Missing rate-limit test"), "the critique reaches the judge");
assert.ok(state.includes("+added"), "the diff reaches the judge");
assert.ok(state.indexOf("Execution critique:") < state.indexOf("Working-tree diff:"), "the claim precedes the evidence");
assert.equal(buildGapTriageState({ critiqueText: "only a critique" }), "Execution critique:\nonly a critique", "a missing diff degrades to critique-only");
assert.equal(buildGapTriageState({ diff: "only a diff" }), "Working-tree diff:\nonly a diff", "a missing critique degrades to diff-only");
assert.equal(buildGapTriageState(), "", "no evidence reads empty, never \"undefined\"");
assert.equal(buildGapTriageState(null), "", "junk reads empty");
assert.equal(buildGapTriageState({ critiqueText: 42, diff: {} }), "", "non-strings never leak into the prompt");
assert.equal(
  buildGapTriageState({ critiqueText: "x".repeat(GAP_TRIAGE_CRITIQUE_CHARS + 500) }),
  `Execution critique:\n${"x".repeat(GAP_TRIAGE_CRITIQUE_CHARS)}`,
  "the critique budget is enforced, so it cannot crowd out the diff",
);

// --- Evidence: measurements behind the verdict. --------------------------------
// An `evidence:` block cites host measurements (symbols, files, caller
// counts, covering tests, reversibility, proving check). Absent reads as
// unmeasured, never as a failure — registries written before it existed,
// and workers on hosts without tools, keep passing byte-identically.
const evHead = (body) => `---\ngaps:\n${body}\n---\n\n# Execution Critique Report\n\n## Summary\n\nWork reviewed.\n`;
const evRow = (desc, evidence) =>
  `  - type: missing-tests\n    area: "auth"\n    description: "${desc}"\n    impact: high\n    resolution: escalate${evidence}`;

const measured = evHead(evRow("Login rate limiter", `
    evidence:
      symbols: [RateLimiter]
      files: [auth/rate-limit.ts]
      callers: 38
      tests: [TestRateLimit]
      reversible: unknown
      check: "npm test -- rate-limit"`));
const parsedEv = parseGapFrontmatter(measured);
assert.equal(parsedEv.gaps.length, 1, "the evidenced row parses");
assert.deepEqual(
  parsedEv.gaps[0].evidence,
  {
    symbols: ["RateLimiter"],
    files: ["auth/rate-limit.ts"],
    callers: 38,
    tests: ["TestRateLimit"],
    reversible: "unknown",
    check: "npm test -- rate-limit",
  },
  "the block normalises to typed measurements",
);
assert.equal(parsedEv.gaps[0].evidenceError ?? null, null, "a clean block carries no error");
// The keys after the block still belong to the gap: a dedented field ends
// the evidence, it is not swallowed into it.
assert.equal(parsedEv.gaps[0].resolution, "escalate", "resolution after evidence: still parses");
assert.equal(parsedEv.gaps[0].impact, "high", "impact before evidence: untouched");

// Rows without the block parse exactly as before — no new keys.
const bare = parseGapFrontmatter(clean).gaps[0];
assert.equal(bare.evidence, undefined, "an unmeasured row gains no evidence key");
assert.equal(bare.evidenceError ?? null, null, "and no error key either");

// Absent evidence never fails, however strict the row is otherwise.
assert.deepEqual(validateGapRegistry(measured), [], "cited measurements pass");
assert.deepEqual(validateGapRegistry(clean), [], "unmeasured registries keep passing");

// Present-but-malformed evidence fails as shape, not silently.
const badCallers = evHead(evRow("Login rate limiter", "\n    evidence:\n      callers: huge"));
assert.equal(fail(validateGapRegistry(badCallers), "gap-evidence-shape").length, 1, "a non-integer caller count fails as shape");
const badReversible = evHead(evRow("Login rate limiter", "\n    evidence:\n      reversible: maybe"));
assert.equal(fail(validateGapRegistry(badReversible), "gap-evidence-shape").length, 1, "an unknown reversibility fails as shape");
const scalarEvidence = evHead(evRow("Login rate limiter", "\n    evidence: just trust me"));
assert.equal(fail(validateGapRegistry(scalarEvidence), "gap-evidence-shape").length, 1, "a scalar evidence fails as shape");

// Normalisation units: flow arrays, singles, empties, and the null spellings.
assert.deepEqual(
  normalizeGapEvidence({ symbols: "[A, B]", files: "x.ts", callers: "3", tests: "[]", reversible: "NO", check: "null" }),
  {
    evidence: { symbols: ["A", "B"], files: ["x.ts"], callers: 3, tests: [], reversible: "no", check: null },
    error: null,
  },
  "flow lists, singles, and spellings normalise",
);
assert.equal(normalizeGapEvidence("scalar").error !== null, true, "a scalar is not a mapping");
assert.equal(normalizeGapEvidence({ callers: "-1" }).error !== null, true, "negative callers fail");

// Only cited measurements count: an empty block is present-but-vacuous.
assert.equal(hasGapEvidence({ symbols: ["A"], files: [], callers: null, tests: [], reversible: null, check: null }), true, "one cited field counts");
assert.equal(hasGapEvidence({ symbols: [], files: [], callers: null, tests: [], reversible: null, check: null }), false, "a vacuous block is unmeasured");
assert.equal(hasGapEvidence(null), false, "no block is unmeasured");
assert.equal(hasGapEvidence(undefined), false, "never undefined-throws");

console.log("gap registry test ok: parse, misclassification gate, contract wiring");
