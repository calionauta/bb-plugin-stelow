import assert from "node:assert/strict";
import {
  frontmatterBlock,
  parseGapFrontmatter,
  escalatedGaps,
  summarizeGaps,
  validateGapRegistry,
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

// Summary drives the card UI and the escalated-rate metric.
assert.deepEqual(summarizeGaps(clean), { found: true, total: 4, fixed: 1, documented: 1, escalated: 2 }, "counts by resolution");
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

// The execution-critique contract enforces the registry end to end.
const contract = contractForBuildArtifact("critiques/Execution Critique Report_v1.md", clean);
assert.ok(contract?.id === "execution-critique", "title routes to the critique contract");
assert.equal(validateArtifact(clean, contract).failures.filter((f) => f.code.startsWith("gap-")).length, 0, "clean critique has no registry failures");
const thin = validateArtifact("# Execution Critique Report\n\nThin prose.", contractForBuildArtifact("critiques/Execution Critique Report_v1.md", "# Execution Critique Report\n\nThin prose."));
assert.ok(thin.failures.some((f) => f.code === "gap-missing-frontmatter"), "thin critique fails on the registry");

console.log("gap registry test ok: parse, misclassification gate, contract wiring");
