import assert from "node:assert/strict";
import { declaresNoWebEvidence, evidenceStatus } from "../lib/research-evidence.mjs";

// Detection keys off the worker's own declaration, in either language.
assert.equal(declaresNoWebEvidence("Evidence limit: web search tools were unavailable this session."), true, "english declaration detected");
assert.equal(declaresNoWebEvidence("Limite de evidência: ferramenta de busca web indisponível nesta sessão."), true, "portuguese declaration detected");
assert.equal(declaresNoWebEvidence("Sem busca web — tudo hipótese."), true, "short portuguese declaration detected");
assert.equal(declaresNoWebEvidence("# Research index\n\n## Opportunities\n- [ ] Something\n"), false, "plain index is verified");
assert.equal(declaresNoWebEvidence(""), false, "empty index is not a declaration");
assert.equal(declaresNoWebEvidence(null), false, "missing index is not a declaration");

// A fabricated-looking denial is not a declaration: only the worker's own
// unavailability phrasing counts, so researched cards never downgrade.
assert.equal(declaresNoWebEvidence("Web research contributed five sources, all cited inline."), false, "researched index stays verified");

assert.equal(evidenceStatus("busca web indisponível"), "hypothesis-only", "status follows declaration");
assert.equal(evidenceStatus("Full web research with cited sources."), "verified", "status defaults to verified");

console.log("research evidence test ok: bilingual declaration, verified default");
