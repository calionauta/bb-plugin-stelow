import assert from "node:assert/strict";
import {
  wordCount,
  tableRowCount,
  tableHeaders,
  sectionItemCount,
  fieldBlockCount,
  validateArtifact,
  validateSubstep,
  sealStatus,
} from "../lib/artifact-validation.mjs";
import { contractForSubstep, JTBD_CONTRACTS } from "../lib/artifact-contracts.mjs";
import { findInvalidSubsteps, researchVerifyReport, researchVerifyText } from "../lib/research-artifacts.mjs";

const INDEX = "# Research index\n\n## Opportunities\n\n- [ ] Something\n";
const pad = (n) => Array(n).fill("filler").join(" ");
const hasCode = (result, code) => result.failures.some((failure) => failure.code === code);

// Helpers: table rows, section items, field blocks.
assert.equal(tableRowCount("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n"), 2, "header and separator excluded");
assert.equal(tableRowCount("no tables here"), 0, "no tables means no rows");
assert.equal(sectionItemCount("## A\n- one\n- two\n## B\n- three\n", "A"), 2, "items stop at next heading");
assert.equal(sectionItemCount("## A\nnothing\n", "A"), 0, "no bullets means no items");
assert.equal(sectionItemCount("nothing", "A"), 0, "missing section means no items");
assert.equal(fieldBlockCount("#### 1\n- A: x\n- B: y\n#### 2\n- A: x\n", "#### ", ["A:", "B:"]), 1, "only complete blocks count");
assert.equal(wordCount("  a b\nc "), 3, "word count");

// Table columns: a passing mention in prose is not a per-item criterion column.
const TASK_TABLE = "| # | Task | Components | Risk | Done Criterion | Order Rationale |\n|---|---|---|---|---|---|\n| 1.1 | Login | api | LOW | Works | P0 |\n";
assert.deepEqual(tableHeaders(TASK_TABLE).filter((h) => h === "task" || h === "done criterion"), ["task", "done criterion"], "headers parsed case-insensitively");
assert.deepEqual(tableHeaders("no tables here"), [], "no tables means no headers");
const colContract = { minWords: 0, checks: [{ kind: "table-columns", names: ["Task", "Done Criterion"] }] };
assert.equal(validateArtifact(TASK_TABLE + pad(10), colContract).pass, true, "task table with Done Criterion passes");
// Mentions "Done Criterion" in prose + has rows, but no criterion column → fails.
const proseMention = `# Plan\n\nDone Criterion matters.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n`;
assert.ok(hasCode(validateArtifact(proseMention + pad(10), colContract), "missing-table-columns"), "prose mention without the column fails");

// Every migrated slug has a contract citing its upstream reference.
assert.equal(JTBD_CONTRACTS.length, 10, "ten JTBD depth contracts");
for (const contract of JTBD_CONTRACTS) {
  assert.ok(contract.slug && contract.ref.endsWith(".md") && contract.checks.length > 0, `${contract.slug} has ref and checks`);
}
assert.equal(contractForSubstep("nope"), null, "unknown slug is unmigrated");

// 1. contextual-segmentation: 8+ complete segment blocks.
const seg = (i) => `## Segment ${i}\n- Market: people ${pad(8)}\n- Justification: reason ${pad(8)}\n- Situational factors: factors ${pad(8)}\n- Desired Outcomes: outcomes ${pad(20)}\n- Constraints: limits ${pad(20)}\n`;
const segPass = Array.from({ length: 8 }, (_, i) => seg(i + 1)).join("\n") + pad(150);
const segFail = `## Segment 1\n- Market: people\n- Justification: reason\n${pad(50)}`;
assert.equal(validateSubstep("contextual-segmentation", segPass).pass, true, "full segmentation passes");
assert.ok(hasCode(validateSubstep("contextual-segmentation", segFail), "incomplete-blocks"), "partial segments fail");

// 2. thinking-styles: exactly 5 styles, 15 table rows.
const style = (name) => `## ${name}\n| Element | Description | Voice example | Source & status |\n|---|---|---|---|\n| Thought | thinks ${pad(10)} | "I think" | Simulated hypothesis — not participant data |\n| Emotion | feels ${pad(10)} | "I feel" | Simulated hypothesis — not participant data |\n| Personal Rule | rules ${pad(10)} | "I always" | Simulated hypothesis — not participant data |\n- Brief description: seeks ${pad(8)}\n- Context: works ${pad(8)}\n- Differentiation: adapts ${pad(8)}\n- Top 3 Functional Jobs: plan, monitor, optimize ${pad(8)}\n- Top 2 Emotional Jobs: secure, calm ${pad(8)}\n- Top 2 Social Jobs: organized, reliable ${pad(8)}\n`;
const stylesPass = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map(style).join("\n") + "Justification of the five styles. " + pad(170);
assert.equal(validateSubstep("thinking-styles", stylesPass).pass, true, "five styles pass");
assert.ok(hasCode(validateSubstep("thinking-styles", ["A", "B", "C", "D"].map(style).join("\n") + pad(60)), "too-few-headings"), "four styles fail");
assert.ok(hasCode(validateSubstep("thinking-styles", ["A", "B", "C", "D", "E", "F"].map(style).join("\n") + pad(60)), "too-many-headings"), "six styles fail");

// 3. jtbd-discovery: 3 sections, 20 contextual jobs.
const discoveryPass = `## Rewritten JTBDs\n- Rewrite and keep records ${pad(40)}\n## Contextual JTBDs\n${Array.from({ length: 20 }, (_, i) => `- Contextual job number ${i + 1} ${pad(10)}`).join("\n")}\n## Higher functional JTBDs\n- Higher job one ${pad(40)}\n` + pad(280);
assert.equal(validateSubstep("jtbd-discovery", discoveryPass).pass, true, "discovery passes");
assert.ok(hasCode(validateSubstep("jtbd-discovery", "## Rewritten JTBDs\n- one\n## Contextual JTBDs\n- one\n- two\n## Higher functional JTBDs\n- one\n" + pad(600)), "too-few-items"), "two contextual jobs fail");

// 4. competitors: 4 sections, 3 items each.
const compSection = (name) => `## ${name}\n- Example one ${pad(40)}\n- Example two ${pad(40)}\n- Example three ${pad(40)}\n`;
const compPass = ["Direct Competitors", "Indirect Competitors", "Hidden Competitors", "Key Insights"].map(compSection).join("\n");
assert.equal(validateSubstep("competitors", compPass).pass, true, "competitors pass");
assert.ok(hasCode(validateSubstep("competitors", "## Direct Competitors\n- one\n## Indirect Competitors\n- one\n- two\n- three\n## Hidden Competitors\n- one\n## Key Insights\n- one\n- two\n- three\n" + pad(400)), "too-few-items"), "thin direct section fails");

// 5. job-actors: 12 exact roles.
const roles = ["Beneficiary", "Performer", "Provider", "Indirect Beneficiary", "Threatened", "Assistant", "Decision Maker", "Purchaser", "Buyer", "Supervisor", "Influencer", "Expert"];
const actorsPass = roles.map((role) => `## ${role}\nActor group ${pad(48)}\n`).join("\n");
assert.equal(validateSubstep("job-actors", actorsPass).pass, true, "twelve roles pass");
assert.ok(hasCode(validateSubstep("job-actors", actorsPass.replace("## Purchaser\n", "")), "missing-section"), "missing role fails");

// 6. situational-variables: 5 categories, 10 factors.
const variablePass = ["Where", "With Whom", "When", "Why", "How"].map((cat) => `## Category: ${cat}\n### Situational factor: factor one ${pad(10)}\n- variable one: justification ${pad(15)}\n- variable two: justification ${pad(15)}\n### Situational factor: factor two ${pad(10)}\n- variable three: justification ${pad(15)}\n- variable four: justification ${pad(15)}\n`).join("\n");
assert.equal(validateSubstep("situational-variables", variablePass).pass, true, "variables pass");
assert.ok(hasCode(validateSubstep("situational-variables", "## Category: Where\n### Situational factor: one\n- var: why\n" + pad(500)), "too-few-headings"), "one category fails");

// 7. functional-needs: Top 10 with five fields each + summary table.
const criterion = (i) => `#### ${i}/10 Ensure outcome number ${i}\n- Alternative: achieve result ${i} ${pad(6)}\n- Justification: ideal because ${pad(12)}\n- Score: impacts factors ${pad(12)}\n- Metrics: speed ease consistency ${pad(52)}\n- Current solutions: mental physical virtual ${pad(12)}\n`;
const functionalPass = `## Top 10:\n${Array.from({ length: 10 }, (_, i) => criterion(i + 1)).join("\n")}\n## Summary of Success Criteria\n| Success Criterion | Alternative |\n| :--- | :--- |\n${Array.from({ length: 10 }, (_, i) => `| Criterion ${i + 1} | Alternative ${i + 1} |`).join("\n")}\n`;
assert.equal(validateSubstep("functional-needs", functionalPass).pass, true, "functional needs pass");
const incidentFunctional = `# Sub-etapa: necessidades funcionais\n## Critérios de sucesso\n- Ensure recebimento do protocolo\n- Ensure compreensão do motivo\n- Ensure conclusão do pedido\n- Avoid deslocamento para consulta\n- Ensure validade do documento\n- Avoid perda do prazo\n- Ensure correção de dado\n- Avoid exposição de dado\n- Ensure comprovação de elegibilidade\n- Avoid fila sem previsão\n`;
const incidentResult = validateSubstep("functional-needs", incidentFunctional);
assert.equal(incidentResult.pass, false, "incident-style names-only file fails");
assert.ok(hasCode(incidentResult, "missing-section"), "names-only file misses Top 10 section");

// 8. financial-needs: 30 raw + Top 20 detailed.
const raw30 = `## 30 Raw Success Criteria\n${Array.from({ length: 30 }, (_, i) => `- Minimize the cost of item ${i + 1}`).join("\n")}\n`;
const top20 = `## Top 20:\n${Array.from({ length: 20 }, (_, i) => `#### ${i + 1}/20 Minimize the cost of item ${i + 1}\n- Alternative: reduce spending ${i + 1} ${pad(4)}\n- Justification: ideal because ${pad(8)}\n- Score: impacts factors ${pad(8)}\n- Metrics: count proportion average ${pad(20)}\n- Current solutions: mental physical virtual ${pad(8)}\n`).join("\n")}\n`;
assert.equal(validateSubstep("financial-needs", raw30 + top20).pass, true, "financial needs pass");
assert.ok(hasCode(validateSubstep("financial-needs", "## 30 Raw Success Criteria\n- Minimize the cost of one\n- Minimize the cost of two\n## Top 20:\n" + pad(1500)), "too-few-items"), "two raw criteria fail");

// 9. emotional-social-jobs: both sections, 5 items each.
const emotionalPass = `### Emotional Jobs:\n${Array.from({ length: 5 }, (_, i) => `  - Feel confident while acting ${i + 1} ${pad(36)}`).join("\n")}\n### Social Jobs:\n${Array.from({ length: 5 }, (_, i) => `  - Be perceived as capable ${i + 1} ${pad(36)}`).join("\n")}\n`;
assert.equal(validateSubstep("emotional-social-jobs", emotionalPass).pass, true, "emotional/social pass");
assert.ok(hasCode(validateSubstep("emotional-social-jobs", "### Emotional Jobs:\n  - Feel confident\n" + pad(400)), "missing-section"), "missing social section fails");

// 10. job-map-steps: 6 stages, 12 steps.
const stages = ["Define and Plan", "Prepare and Execute", "Evaluate and Adjust", "Conclude and Organize", "Document and Share", "Monitor subsequent effects"];
const mapPass = stages.map((stage) => `# ${stage}\n### Step one ${pad(38)}\n### Step two ${pad(38)}\n`).join("\n");
assert.equal(validateSubstep("job-map-steps", mapPass).pass, true, "job map passes");
assert.ok(hasCode(validateSubstep("job-map-steps", "# Define and Plan\n### Step one\n# Prepare and Execute\n### Step two\n" + pad(500)), "missing-section"), "two stages fail");

// Wiring: depth failures flow through findInvalidSubsteps into verify text.
const subs = [{ n: 1, label: "Jobs to be done", slug: "functional-needs", path: "rounds/f.md" }];
const files = { "rounds/f.md": incidentFunctional + pad(1300) };
const depthCheck = (slug, content) => validateSubstep(slug, content).failures.map((failure) => failure.detail);
const invalid = findInvalidSubsteps(subs, (path) => files[path] ?? null, INDEX, depthCheck);
assert.equal(invalid.length, 1, "thin-but-long file fails on depth");
assert.equal(invalid[0].reason, "needs-depth", "reason is needs-depth");
assert.deepEqual(findInvalidSubsteps(subs, () => functionalPass, INDEX, depthCheck), [], "full file passes depth");
assert.deepEqual(findInvalidSubsteps(subs, () => functionalPass, INDEX), [], "no depthCheck keeps presence-only gating");
const depthText = researchVerifyText(researchVerifyReport("card_1", 1, true, invalid));
assert.equal(depthText.exitCode, 1, "depth failure exits 1");
assert.match(depthText.stderr, /functional-needs/, "depth failure names the slug");
assert.match(depthText.stderr, /needs depth/, "depth failure states the reason");

// Seal vocabulary: provenance, not truth — unknown shapes and failed
// validation never render verified.
assert.equal(sealStatus({ pass: true }, "verified"), "verified", "passing verified evidence seals verified");
assert.equal(sealStatus({ pass: true }, "hypothesis-only"), "hypothesis-only", "passing hypothesis evidence seals hypothesis");
assert.equal(sealStatus({ pass: false }, "verified"), "needs-revision", "failing validation seals needs-revision");
assert.equal(sealStatus(null, "verified"), "unverified", "unknown shape seals unverified");

console.log("artifact validation test ok: helpers, ten JTBD contracts, depth wiring");
