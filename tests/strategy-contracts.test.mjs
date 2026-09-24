import assert from "node:assert/strict";
import { contractForStrategy, STRATEGY_CONTRACTS } from "../lib/artifact-contracts.mjs";
import { validateVariant } from "../lib/artifact-validation.mjs";
import { findInvalidRounds } from "../lib/research-artifacts.mjs";

const INDEX = "# Research index\n\n## Opportunities\n\n- [ ] Something\n";
const pad = (n) => Array(n).fill("filler").join(" ");
const hasCode = (result, code) => result.failures.some((failure) => failure.code === code);

// Every research strategy has a primary-file contract citing its skill.
const STRATEGY_IDS = ["job-to-be-done", "business-models", "evolutionary", "promotions", "market-analysis", "marketplace", "open-source", "opportunity-mapping", "paywall", "pricing", "ads", "discovery", "product-health", "trust-building"];
assert.deepEqual(STRATEGY_CONTRACTS.map((entry) => entry.id).sort(), [...STRATEGY_IDS].sort(), "all strategies contracted");
for (const contract of STRATEGY_CONTRACTS) {
  assert.ok(contract.ref.startsWith("skills/"), `${contract.id} cites its skill`);
}
assert.equal(contractForStrategy("nope"), null, "unknown strategy is unmigrated");

// Guidance skills: headings + terms + words; a long generic note still fails.
const loose = [
  { id: "ads", words: 500, headings: 5, terms: ["awareness", "kill criteria"] },
  { id: "business-models", words: 600, headings: 3, terms: ["cost", "revenue", "experiment"] },
  { id: "discovery", words: 600, headings: 3, terms: ["experiment", "threshold"] },
  { id: "evolutionary", words: 600, headings: 3, terms: ["optionality", "revisit"] },
  { id: "product-health", words: 500, headings: 3, terms: ["tension", "verdict", "metric"] },
  { id: "marketplace", words: 600, headings: 3, terms: ["tactic", "constraint"] },
  { id: "open-source", words: 600, headings: 3, terms: ["thesis", "moat", "experiment"] },
  { id: "pricing", words: 600, headings: 3, terms: ["metric", "guardrail", "perception"] },
  { id: "promotions", words: 600, headings: 3, terms: ["offer", "cap", "rollback"] },
  { id: "trust-building", words: 500, headings: 3, terms: ["guarantee"] },
  { id: "job-to-be-done", words: 500, headings: 2, terms: [] },
];
for (const { id, words, headings, terms } of loose) {
  const sections = Array.from({ length: headings }, (_, i) => `## Section ${i + 1}\nBody text ${pad(20)}\n`).join("\n");
  const pass = `${sections}\nTerms: ${terms.join(", ")}. ${pad(words)}`;
  assert.equal(validateVariant(pass, contractForStrategy(id)).pass, true, `${id} full primary passes`);
  const thin = `## Notes\n${pad(60)}`;
  assert.equal(validateVariant(thin, contractForStrategy(id)).pass, false, `${id} generic note fails depth`);
}

// Opportunity mapping: 3 opportunities, 12 solutions, appetite each.
const solution = (o, s) => `### SOLUTION ${o}.${s}: name ${pad(10)}\n- **Suggested Time Appetite:** 4 weeks - justification ${pad(20)}\n- **Description and Initial Scope:** scope ${pad(30)}\n- **Strategy:** Differentiated - justification ${pad(15)}\n- **Main Value Areas:** areas ${pad(10)}\n- **Assumptions:** assumptions ${pad(15)}\n`;
const oppPass = `## Index of Opportunities and Solutions\n${[1, 2, 3].map((o) => `## OPPORTUNITY ${o}: name ${pad(10)}\n${[1, 2, 3, 4].map((s) => solution(o, s)).join("\n")}`).join("\n")}`;
assert.equal(validateVariant(oppPass, contractForStrategy("opportunity-mapping")).pass, true, "opportunity map passes");
assert.ok(hasCode(validateVariant(`## OPPORTUNITY 1: name\n${solution(1, 1)}${pad(1100)}`, contractForStrategy("opportunity-mapping")), "too-few-headings"), "one opportunity fails");

// Market analysis: either variant passes; closest failure reported otherwise.
const deep = `## Recent Past\nPESTLE analysis ${pad(120)}\n## Current Trends\nForesight signals ${pad(120)}\n## Future Predictions\nDelphi consensus and Wardley evolution ${pad(120)}\n## Methods\n## Synthesis\n## Risks\n${pad(450)}`;
const canvas = `#### Executive Summary\nSummary ${pad(65)}\n#### Top Announcements\n| Company | Type | Summary | Link |\n|---|---|---|---|\n| A | launch | news | link |\n| B | funding | news | link |\n| C | release | news | link |\n#### Key Insights\nInsights ${pad(65)}\n#### Competitive Snapshot\nSnapshot ${pad(65)}\n#### Foresight Signals\nSignals ${pad(65)}\n#### Wardley Evolution\nCommodity evolution ${pad(65)}\n#### Recommended Actions\nActions ${pad(65)}\n#### Sources\nSources ${pad(65)}\n\`\`\`mermaid\ngraph TD\nA-->B\n\`\`\`\n`;
assert.equal(validateVariant(deep, contractForStrategy("market-analysis")).pass, true, "deep variant passes without canvas markers");
assert.equal(validateVariant(canvas, contractForStrategy("market-analysis")).pass, true, "canvas variant passes without deep terms");
const neither = `## Notes\n${pad(900)}`;
const neitherResult = validateVariant(neither, contractForStrategy("market-analysis"));
assert.equal(neitherResult.pass, false, "neither variant fails");
assert.ok(neitherResult.failures.length > 0, "closest variant failures reported");

// Paywall: diagnosis or design passes.
const diagnosis = `## Funnel data\nData ${pad(80)}\n## Benchmarks\nScores against the three benchmarks ${pad(80)}\n## Verdict\nVerdict and fix plan ${pad(80)}\n${pad(350)}`;
const design = `## Onboarding\nOnboarding screens ${pad(80)}\n## Paywall options\nAnnual anchored ${pad(80)}\n## Trial policy and build order\nNo trial until payment proven ${pad(80)}\n${pad(350)}`;
assert.equal(validateVariant(diagnosis, contractForStrategy("paywall")).pass, true, "diagnosis mode passes");
assert.equal(validateVariant(design, contractForStrategy("paywall")).pass, true, "design mode passes");
assert.equal(validateVariant(`## Notes\n${pad(700)}`, contractForStrategy("paywall")).pass, false, "modeless paywall fails");

// validateVariant with no variants delegates to plain checks.
assert.equal(validateVariant("anything", null).pass, true, "null contract passes (unmigrated)");

// Wiring: primary depth flows through findInvalidRounds with reason + detail.
const history = [{ id: "pricing", at: "t", file: "rounds/pricing-r1.md" }];
const full = `## Metric\nMetric recommendation ${pad(150)}\n## Guardrails\nGuardrails ${pad(150)}\n## Perception\nPerception framing ${pad(150)}\n${pad(150)}`;
assert.deepEqual(findInvalidRounds(history, () => full, INDEX, () => "Pricing", (id, content) => validateVariant(content, contractForStrategy(id)).failures.map((f) => f.detail)), [], "full primary passes");
const thinPrimary = `## Notes\n${pad(60)}`;
const primaryInvalid = findInvalidRounds(history, () => thinPrimary, INDEX, () => "Pricing", (id, content) => validateVariant(content, contractForStrategy(id)).failures.map((f) => f.detail));
assert.equal(primaryInvalid.length, 1, "thin primary fails");
assert.equal(primaryInvalid[0].reason, "needs-depth", "primary reason is needs-depth");
assert.deepEqual(findInvalidRounds(history, () => full, INDEX, () => "Pricing"), [], "no depthCheck keeps presence-only gating");

console.log("strategy contracts test ok: fourteen strategies, variants, primary wiring");
