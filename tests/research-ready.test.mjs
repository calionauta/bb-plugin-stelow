import assert from "node:assert/strict";
import { isResearchReadyForReview, researchReadyFingerprint } from "../lib/research-ready.mjs";

// The reported bug: a research card whose brief held 7 opportunities still
// raised "paused — idle with unfinished research". Ready shares the fan-out
// convention (brief ## Opportunities checkboxes), never free-text output.
const READY = `# Research brief: impacto de IA
Strategy: Market analysis
## Findings
AI expands demand.
## Opportunities
### Market analysis — 2026-09-05
- [ ] Hibrido — vender o chatbot como extensao
- [ ] Supervisao productizada — QA de cuidado guiado
`;

assert.equal(isResearchReadyForReview(READY), true, "brief with opportunities is ready");
assert.equal(researchReadyFingerprint(READY), "2", "fingerprint is the opportunity count");

assert.equal(isResearchReadyForReview("# brief\n## Findings\nOnly findings, no opportunities section.\n"), false, "findings without opportunities are not ready");
assert.equal(isResearchReadyForReview(""), false, "empty brief is not ready");
assert.equal(isResearchReadyForReview(null), false, "missing brief is not ready");
assert.equal(researchReadyFingerprint("no convention here"), null, "non-convention brief has no fingerprint");

// Checked boxes still count: fan-out checks them later; completeness is
// what the readiness signal measures, same as the fan-out dialog sees it.
assert.equal(isResearchReadyForReview(`${READY}- [x] Done — already fanned out\n`), true, "checked items keep readiness");
assert.equal(researchReadyFingerprint(`${READY}- [x] Done — already fanned out\n`), "3", "checked items join the count");

// A second strategy round grows the brief and earns a fresh completion
// event; re-polls of the same brief stay idempotent under the same key.
assert.notEqual(
  researchReadyFingerprint(`${READY}### JTBD — 2026-09-06\n- [ ] Extra — another round\n`),
  researchReadyFingerprint(READY),
  "grown brief fingerprints differently",
);

console.log("research ready test ok: fan-out convention reuse, fingerprint growth");
