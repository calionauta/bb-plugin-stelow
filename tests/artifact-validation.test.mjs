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
assert.equal(JTBD_CONTRACTS.length, 11, "eleven JTBD depth contracts");
for (const contract of JTBD_CONTRACTS) {
  assert.ok(contract.slug && contract.ref.endsWith(".md") && contract.checks.length > 0, `${contract.slug} has ref and checks`);
}
assert.equal(contractForSubstep("nope"), null, "unknown slug is unmigrated");

// 1. contextual-segmentation: 4+ complete segment blocks with the new fields.
const segBlock = (i) => [
  `## Segment ${i}`,
  `- Market: people ${pad(8)}`,
  `- Justification: reason ${pad(8)}`,
  `- Situational factors: factors ${pad(8)}`,
  `- Scene: a tuesday ${pad(10)}`,
  `- Observable difference: they print ${pad(10)}`,
  `- Cost of failure: late close ${pad(10)}`,
].join("\n");
const segPass = Array.from({ length: 6 }, (_, i) => segBlock(i + 1)).join("\n") + pad(700);
const segFail = `## Segment 1\n- Market: people\n- Justification: reason\n${pad(50)}`;
assert.equal(validateSubstep("contextual-segmentation", segPass).pass, true, "six segments pass");
assert.ok(
  hasCode(validateSubstep("contextual-segmentation", segFail), "incomplete-blocks"),
  "partial segments fail",
);

// 2. thinking-styles: 3..7 styles, table rows scale with the band.
const styleRow = (element, description, voice) =>
  `| ${element} | ${description} ${pad(10)} | "${voice}" | Simulated hypothesis — not participant data |`;
const STYLE_TABLE_HEADER =
  '| Element | Description | Voice example | Source & status |\n|---|---|---|---|\n';
const style = (name) => [
  `## ${name}`,
  STYLE_TABLE_HEADER.trimEnd(),
  styleRow("Thought", "thinks", "I think"),
  styleRow("Emotion", "feels", "I feel"),
  styleRow("Personal Rule", "rules", "I always"),
  `- Brief description: seeks ${pad(8)}`,
  `- Context: works ${pad(8)}`,
  `- Differentiation: adapts ${pad(8)}`,
  `- Top 3 Functional Jobs: plan, monitor, optimize ${pad(8)}`,
  `- Top 2 Emotional Jobs: secure, calm ${pad(8)}`,
  `- Top 2 Social Jobs: organized, reliable ${pad(8)}`,
].join("\n") + "\n";
const stylesPass = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map(style).join("\n")
  + "Justification of the five styles. " + pad(170);
assert.equal(validateSubstep("thinking-styles", stylesPass).pass, true, "five styles pass");
assert.equal(
  validateSubstep("thinking-styles", ["A", "B", "C", "D"].map(style).join("\n") + pad(170)).pass,
  true,
  "four styles pass inside the band",
);
assert.ok(
  hasCode(validateSubstep("thinking-styles", ["A", "B"].map(style).join("\n") + pad(60)), "too-few-headings"),
  "two styles fail",
);
assert.ok(
  hasCode(
    validateSubstep("thinking-styles", ["A", "B", "C", "D", "E", "F", "G", "H"].map(style).join("\n") + pad(60)),
    "too-many-headings",
  ),
  "eight styles fail",
);

// 3. jtbd-discovery: 3 sections, 6+ contextual jobs.
const CONTEXTUAL = Array.from(
  { length: 20 },
  (_, i) => `- Contextual job number ${i + 1} ${pad(10)}`,
).join("\n");
const discoveryPass = [
  "## Rewritten JTBDs",
  `- Rewrite and keep records ${pad(40)}`,
  "## Contextual JTBDs",
  CONTEXTUAL,
  "## Higher functional JTBDs",
  `- Higher job one ${pad(40)}`,
].join("\n") + pad(280);
assert.equal(validateSubstep("jtbd-discovery", discoveryPass).pass, true, "discovery passes");
assert.ok(
  hasCode(
    validateSubstep("jtbd-discovery", "## Rewritten JTBDs\n- one\n## Contextual JTBDs\n- one\n- two\n## Higher functional JTBDs\n- one\n" + pad(600)),
    "too-few-items",
  ),
  "two contextual jobs fail",
);

// 4. competitors: 4 sections, 3 items each.
const compSection = (name) => `## ${name}\n- Example one ${pad(40)}\n- Example two ${pad(40)}\n- Example three ${pad(40)}\n`;
const compPass = ["Direct Competitors", "Indirect Competitors", "Hidden Competitors", "Key Insights"].map(compSection).join("\n");
assert.equal(validateSubstep("competitors", compPass).pass, true, "competitors pass");
assert.ok(
  hasCode(
    validateSubstep(
      "competitors",
      [
        "## Direct Competitors", "- one",
        "## Indirect Competitors", "- one", "- two", "- three",
        "## Hidden Competitors", "- one",
        "## Key Insights", "- one", "- two", "- three",
      ].join("\n") + pad(400),
    ),
    "too-few-items",
  ),
  "thin direct section fails",
);

// 5. job-actors: a fixed-shape verdict table, one line per role.
const ACTOR_ROLES = [
  "Beneficiary", "Performer", "Provider", "Indirect Beneficiary", "Threatened",
  "Assistant", "Decision Maker", "Purchaser", "Buyer", "Supervisor", "Influencer",
  "Expert",
];
const actorRow = (role) => `| ${role} | Input-derived | actor group ${pad(6)} | market ${pad(6)} | "quote" |`;
const actorsPass = "| Role | Status | Actor | Market | Warrant |\n|---|---|---|---|---|\n"
  + ACTOR_ROLES.map(actorRow).join("\n") + "\n" + pad(400);
assert.equal(validateSubstep("job-actors", actorsPass).pass, true, "verdict table passes");
assert.ok(
  hasCode(validateSubstep("job-actors", actorsPass.replace("| Market |", "| Mercado |")), "missing-table-columns"),
  "renamed column fails",
);

// 6. situational-variables: 5 categories, 10 factors.
const variableBlock = (cat) => [
  `## Category: ${cat}`,
  `### Situational factor: factor one ${pad(10)}`,
  `- variable one: justification ${pad(15)}`,
  `- variable two: justification ${pad(15)}`,
  `### Situational factor: factor two ${pad(10)}`,
  `- variable three: justification ${pad(15)}`,
  `- variable four: justification ${pad(15)}`,
].join("\n");
const variablePass = ["Where", "With Whom", "When", "Why", "How"].map(variableBlock).join("\n");
assert.equal(validateSubstep("situational-variables", variablePass).pass, true, "variables pass");
assert.ok(
  hasCode(validateSubstep("situational-variables", "## Category: Where\n### Situational factor: one\n- var: why\n" + pad(500)), "too-few-headings"),
  "one category fails",
);

// 7. functional-needs: depth-floor criteria with four fields + summary table.
const criterion = (i) => [
  `#### ${i}/10 Ensure outcome number ${i}`,
  `- Justification: ideal because ${pad(12)}`,
  `- Score: impacts factors ${pad(12)} — **Basis:** inferência`,
  `- Metrics: speed ease consistency ${pad(52)}`,
  `- Current alternative: mental physical virtual ${pad(12)}`,
].join("\n");
const functionalPass = "## Top 10:\n"
  + Array.from({ length: 10 }, (_, i) => criterion(i + 1)).join("\n")
  + "\n## Summary of Success Criteria\n| Success Criterion | Alternative |\n| :--- | :--- |\n"
  + Array.from({ length: 10 }, (_, i) => `| Criterion ${i + 1} | Alternative ${i + 1} |`).join("\n") + "\n";
assert.equal(validateSubstep("functional-needs", functionalPass).pass, true, "functional needs pass");
const incidentFunctional = [
  "# Sub-etapa: necessidades funcionais",
  "## Critérios de sucesso",
  "- Ensure recebimento do protocolo",
  "- Ensure compreensão do motivo",
  "- Ensure conclusão do pedido",
  "- Avoid deslocamento para consulta",
  "- Ensure validade do documento",
  "- Avoid perda do prazo",
  "- Ensure correção de dado",
  "- Avoid exposição de dado",
  "- Ensure comprovação de elegibilidade",
  "- Avoid fila sem previsão",
].join("\n");
const incidentResult = validateSubstep("functional-needs", incidentFunctional);
assert.equal(incidentResult.pass, false, "incident-style names-only file fails");
assert.ok(hasCode(incidentResult, "missing-section"), "names-only file misses Top 10 section");

// 8. financial-needs: depth floors for raw and top criteria.
const raw30 = "## Raw Success Criteria\n"
  + Array.from({ length: 30 }, (_, i) => `- Minimize the cost of item ${i + 1}`).join("\n") + "\n";
const financeRow = (i) => [
  `#### ${i + 1}/20 Minimize the cost of item ${i + 1}`,
  `- Justification: ideal because ${pad(8)}`,
  `- Score: impacts factors ${pad(8)} — **Basis:** inferência`,
  `- Metrics: count proportion average ${pad(20)}`,
  `- Current alternative: mental physical virtual ${pad(8)}`,
].join("\n");
const top20 = "## Top criteria:\n" + Array.from({ length: 20 }, (_, i) => financeRow(i)).join("\n") + "\n";
assert.equal(validateSubstep("financial-needs", raw30 + top20).pass, true, "financial needs pass");
assert.ok(
  hasCode(
    validateSubstep("financial-needs", "## Raw Success Criteria\n- Minimize the cost of one\n## Top criteria:\n" + pad(1500)),
    "too-few-items",
  ),
  "two raw criteria fail",
);

// 9. emotional-social-jobs: anchored table, one emotional and one social per step.
const emoRow = (i, kind) => `| step ${i} | statement ${kind} ${i} ${pad(6)} | ${kind} | signal ${i} ${pad(6)} | Hypothesis — bet |`;
const EMO_HEADER = "| Step | Job | Type | Signal | Status |\n|---|---|---|---|---|\n";
const emotionalPass = EMO_HEADER
  + [1, 2, 3].flatMap((i) => [emoRow(i, "Emotional"), emoRow(i, "Social")]).join("\n")
  + "\n" + pad(300);
assert.equal(validateSubstep("emotional-social-jobs", emotionalPass).pass, true, "anchored emotional/social passes");
assert.ok(
  hasCode(validateSubstep("emotional-social-jobs", EMO_HEADER + emoRow(1, "Emotional") + "\n" + pad(400)), "missing-table-rows"),
  "one anchored row fails",
);

// 10. job-map-steps: a fixed-shape step table with at least five rows.
const stepRow = (i) => `| ${i} | step ${pad(4)} | Prepare and Execute | analyst | Open | output ${pad(4)} | failure ${pad(4)} | Hypothesis — bet |`;
const MAP_HEADER = "| # | Step | Phase | Executor | Decider | Output | Failure mode | Status |\n|---|---|---|---|---|---|---|---|\n";
const mapPass = MAP_HEADER + Array.from({ length: 7 }, (_, i) => stepRow(i + 1)).join("\n") + "\n" + pad(500);
assert.equal(validateSubstep("job-map-steps", mapPass).pass, true, "step table passes");
assert.ok(
  hasCode(validateSubstep("job-map-steps", mapPass.replace("| Decider |", "| Quem decide |")), "missing-table-columns"),
  "renamed decider column fails",
);
assert.ok(
  hasCode(validateSubstep("job-map-steps", MAP_HEADER + stepRow(1) + "\n" + pad(600)), "missing-table-rows"),
  "one step fails",
);

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
