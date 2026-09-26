import assert from "node:assert/strict";
import { EXPLORE_CONTRACTS, contractForExplore, contractForBuildArtifact } from "../lib/artifact-contracts.mjs";
import { validateExplore, buildDocDepths } from "../lib/artifact-validation.mjs";
import { exploreVerifyReport, exploreVerifyText } from "../lib/research-artifacts.mjs";

const pad = (n) => Array(n).fill("filler").join(" ");
const hasCode = (result, code) => result.failures.some((failure) => failure.code === code);

assert.deepEqual(
  EXPLORE_CONTRACTS.map((entry) => entry.id).sort(),
  [
    "codebase-critique", "execution-critique", "interface-alternatives", "interface-contrast",
    "plan-critique", "shape-up", "tech-planning", "testing-ai-code", "ux-critique",
  ].sort(),
  "nine explore contracts",
);
assert.equal(contractForExplore("nope"), null, "unknown stage is unmigrated");

// Shape Up: frontmatter + four structure sections + scope table.
const shapePass = `---
name: demo
product_type: software
appetite: Core
---
## Unanswered questions
Questions ${pad(40)}
## Strategic shaping alternatives
Alternatives ${pad(40)}
## Structured shape up proposal
### Problem
Problem ${pad(40)}
### Solution
Solution ${pad(40)}
### Dangers and uncertainties
Dangers ${pad(40)}
### Out of scope
Excluded ${pad(40)}
### Scope Table
| OUT | IN |
|-----|-----|
| Admin | App |
| Legacy | Core |
${pad(520)}`;
assert.equal(validateExplore("shape-up", shapePass).pass, true, "shape-up passes");
assert.ok(hasCode(validateExplore("shape-up", `## Notes\n${pad(900)}`), "missing-section"), "shape-up without structure fails");

// Interface alternatives: named sections + state table + ASCII.
const ifacePass = `## Work Pattern Declaration
Pattern ${pad(40)}
## Philosophy and Design Guidelines
Philosophy ${pad(40)}
## Breadboarding
Breadboard ${pad(40)}
## Main Interface Sketch (ASCII)
Sketch ${pad(40)}
## Interaction Flow (ASCII)
Flow ${pad(40)}
## Trade-Off Analysis
Trade-offs ${pad(40)}
## Design Smell Audit
Smells ${pad(40)}
## State Coverage Table
| Component | Type | Idle | Coverage |
|---|---|---|---|
| Btn | Int | yes | 6/6 |
| Title | Disp | yes | 2/2 |
${pad(460)}`;
assert.equal(validateExplore("interface-alternatives", ifacePass).pass, true, "interface proposals pass");
assert.ok(hasCode(validateExplore("interface-alternatives", `## Work Pattern Declaration\nPattern\n${pad(800)}`), "missing-section"), "single section fails");

// Plan critique: frontmatter gaps + verdict.
const planCritiquePass = `---
gaps:
  - severity: critical
verdict: "has gaps"
---
## Executive Summary
Summary ${pad(60)}
## Critical Gaps
Gaps ${pad(60)}
## Important Gaps
Gaps ${pad(60)}
## Minor Clarifications
Notes ${pad(60)}
## Strengths
Strong ${pad(60)}
${pad(300)}`;
assert.equal(validateExplore("plan-critique", planCritiquePass).pass, true, "plan critique passes");
assert.ok(hasCode(validateExplore("plan-critique", `## Notes\n${pad(700)}`), "missing-content"), "critique without gaps fails");

// Tech planning: scopes + sequence + task table.
const techPass = `## Product Context
Context ${pad(60)}
## Identified Scopes
Scopes ${pad(60)}
## High-Level Sequence of Identified Scopes
Sequence ${pad(60)}
## Detailed Development Sequence per Scope
- **Scope:** Auth
- **Type:** feature
- **Dependencies:** none
| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|---|---|---|---|---|
| 1.1 | Build auth | api | LOW | Criterion | P0 |
| 1.2 | Add login | ui | HIGH | Criterion | P3 |
## Final Summary
Summary ${pad(60)}
${pad(500)}`;
assert.equal(validateExplore("tech-planning", techPass).pass, true, "tech plan passes");
assert.ok(hasCode(validateExplore("tech-planning", `## Notes\n${pad(900)}`), "missing-section"), "tech plan without scopes fails");

// Codebase + UX critiques: summary + strengths floors.
assert.equal(validateExplore("codebase-critique", `## Executive Summary\nSummary ${pad(120)}\n## Critical Issues\nIssues ${pad(120)}\n## Strengths\nStrong ${pad(120)}\n${pad(250)}`).pass, true, "codebase critique passes");
assert.equal(validateExplore("ux-critique", `## Executive Summary\nSummary ${pad(100)}\n## Critical Issues\naccessibility issues ${pad(100)}\n## Strengths\nStrong ${pad(100)}\n${pad(300)}`).pass, true, "ux critique passes");
assert.equal(validateExplore("ux-critique", `## Executive Summary\nSummary ${pad(150)}\n## Strengths\nStrong ${pad(150)}\n${pad(200)}`).pass, false, "ux critique without accessibility fails");

// Testing strategy: frontmatter + tables + gates.
const testingPass = `---
version: 1
product_type: software
---
# Testing Strategy
## Tech Stack
Stack ${pad(40)}
## Coverage and Risk Targets
| Path Type | Required Evidence |
|---|---|
| Critical | Branch coverage |
| Standard | Core paths |
## Test Scopes
| Scope | Type | Required Evidence |
|---|---|---|
| Auth | test-unit | Critical path |
| API | test-integration | Seams |
## CI/CD Gates
Gates ${pad(40)}
## Anti-Patterns
Patterns ${pad(40)}
${pad(420)}`;
assert.equal(validateExplore("testing-ai-code", testingPass).pass, true, "testing strategy passes");
assert.ok(hasCode(validateExplore("testing-ai-code", `## Notes\n${pad(700)}`), "missing-table-rows"), "testing strategy without tables fails");

// Execution critique: summary + 8 criteria + registry + lessons + decision.
const execPass = `---
gaps:
  - type: scope
    area: "auth"
    description: "Missing rate limiter"
    impact: high
    resolution: escalate
  - type: docs
    area: "readme"
    description: "Update install docs"
    impact: low
    resolution: documented
---
## Summary
| Metric | Value |
|---|---|
| Items evaluated | 5 |
| Gaps identified | 2 |
${["Completeness", "Quality", "Invisible", "Edge", "Docs", "Registry", "Lessons", "Conversion"].map((c) => `### ${c}\nText ${pad(30)}`).join("\n")}
## Gap Registry
| Gap Type | Description | Impact | Effort | Action | Status |
|---|---|---|---|---|---|
| scope | Missing rate limiter | high | low | ESCALATE | ESCALATED |
| docs | Update install docs | low | low | DOC | DOCUMENTED |
## Lessons Learned
Lessons ${pad(80)}
## Decision
Decision ${pad(80)}
${pad(350)}`;
assert.equal(validateExplore("execution-critique", execPass).pass, true, "execution critique passes");
assert.equal(validateExplore("execution-critique", `## Notes\n${pad(900)}`).pass, false, "execution critique without registry fails");
assert.equal(validateExplore("unknown-stage", "anything").pass, true, "unknown stage passes");

// Build matching: filename rules first, title fallback, exclusions never match.
assert.equal(contractForBuildArtifact("plans/spec-product_v1.md")?.id, "shape-up", "spec-product matches");
assert.equal(contractForBuildArtifact("plans/spec-tech_v2.md")?.id, "tech-planning", "spec-tech matches");
assert.equal(contractForBuildArtifact("interfaces/selected-interface.md")?.id, "interface-alternatives", "selected interface matches");
assert.equal(contractForBuildArtifact("plans/testing-strategy.md")?.id, "testing-ai-code", "testing strategy matches");
assert.equal(contractForBuildArtifact("critiques/critique-report.md")?.id, "plan-critique", "plan critique report matches");
assert.equal(contractForBuildArtifact(".stelow-codebase-critique/critique-report.md")?.id, "codebase-critique", "codebase path wins");
assert.equal(contractForBuildArtifact(".stelow-ux-critique/live-audit-report.md")?.id, "ux-critique", "live audit matches");
assert.equal(contractForBuildArtifact("notes.md", "# Execution Critique Report\n" + pad(900))?.id, "execution-critique", "title fallback matches");
assert.equal(contractForBuildArtifact("audit.md", pad(900)), null, "audit never matches");
assert.equal(contractForBuildArtifact("gate-approved.md", pad(900)), null, "receipts never match");
assert.equal(contractForBuildArtifact("notes.md", pad(900)), null, "unknown docs never match");
assert.equal(contractForBuildArtifact("notes.txt", pad(900)), null, "non-markdown never matches");

// buildDocDepths: only matched failing docs surface.
const state = `artifacts:
  - stage: shape
    kind: document
    path: plans/spec-product_v1.md
    label: Spec
  - stage: planning
    kind: document
    path: plans/spec-tech_v1.md
    label: Tech
  - stage: audit
    kind: document
    path: audit.md
    label: Audit
  - stage: other
    kind: document
    path: notes.md
    label: Notes
`;
const files = {
  "plans/spec-product_v1.md": `## Notes\n${pad(900)}`,
  "plans/spec-tech_v1.md": techPass,
  "audit.md": "thin",
  "notes.md": "thin",
};
const depths = buildDocDepths(state, (path) => files[path] ?? null);
assert.equal(depths.length, 1, "only the thin spec-product surfaces");
assert.equal(depths[0].path, "plans/spec-product_v1.md", "path named");
assert.ok(depths[0].failures.length > 0, "failures detailed");
assert.deepEqual(buildDocDepths("no manifest here", () => null), [], "no manifest means no depths");

// Explore verify renders depth failures; old 3-arg calls keep working.
const failReport = exploreVerifyReport("card_1", "shape-up", false, ["expected at least 800 words, found 120"]);
assert.equal(failReport.pass, false, "depth failure fails");
const failText = exploreVerifyText(failReport);
assert.equal(failText.exitCode, 1, "depth failure exits 1");
assert.match(failText.stderr, /needs depth/, "depth failure states the reason");
assert.match(failText.stderr, /explore-shape-up\.md/, "depth failure names the file");

console.log("explore build contracts test ok: eight stages, build matching, verify wiring");
