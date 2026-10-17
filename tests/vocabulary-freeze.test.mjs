import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { STAGE_CATALOG, STAGE_TRANSITIONS } from "../lib/workflow-catalog.mjs";
import { CANONICAL_VOCABULARY, VOCABULARY_COMPAT, normalizeVocabularyTerm } from "../lib/vocabulary-compat.mjs";
import { auditStageCatalog } from "../lib/transition-facts.mjs";
import { contractForTrackable } from "../lib/trackable-contracts.mjs";
import { parseNextStages } from "../server/runtime/workflow-state.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Single definition: exactly one STAGE_CATALOG export outside its REF.
{
  const out = execSync(
    `grep -rn "export const STAGE_CATALOG\\b" --include="*.mjs" --include="*.ts" lib/ server/ | grep -v "STAGE_CATALOG_REF"`,
    { cwd: root },
  ).toString().trim().split("\n").filter(Boolean);
  assert.equal(out.length, 1, `one STAGE_CATALOG def, got: ${out.join("; ")}`);
  assert.match(out[0], /lib\/workflow-catalog\.mjs/);
}

// Frozen canonical vocabulary + one compat map.
assert.deepEqual([...CANONICAL_VOCABULARY].sort(), ["preset", "question", "scope", "stage"]);
assert.ok(Object.isFrozen(CANONICAL_VOCABULARY));
assert.deepEqual(Object.keys(VOCABULARY_COMPAT).sort(), ["ask", "gate", "handler", "phase", "step", "task", "track", "trackable"]);
assert.ok(Object.isFrozen(VOCABULARY_COMPAT));
assert.equal(normalizeVocabularyTerm("ask"), "question");
assert.equal(normalizeVocabularyTerm("stage"), "stage");
assert.equal(normalizeVocabularyTerm("nope"), "nope");

// Compat resolves through the one map: legacy aliases reach their contract.
assert.equal(contractForTrackable("question")?.kind, "question");
assert.equal(contractForTrackable("ask")?.kind, "question", "ask resolves to the question contract");
assert.equal(contractForTrackable("gate")?.kind, "question", "gate resolves to the question contract");
assert.equal(contractForTrackable("track")?.kind, "stage", "track resolves to the stage contract");

// Advance path reads the catalog, never markdown. The pin this replaces read
// workflow-state.ts for four literals, so a parser that quietly kept reading
// the prose mirror passed as long as the import line still named the catalog.
// Driving the real projection with a bogus mirror beside it cannot: every
// stage's moves must equal its catalog row.
{
  const scratch = mkdtempSync(join(tmpdir(), "stelow-vocab-freeze-"));
  try {
    const references = join(scratch, "skills/stelow-workflow-orchestrator/references");
    mkdirSync(references, { recursive: true });
    writeFileSync(join(references, "transitions.md"), [
      "### shape",
      "next: plan, execute (whatever fits)",
      "### audit",
      "next: (none — stays at audit)",
      "rework: shape (shape rework — same stage)",
    ].join("\n"));
    for (const [stage, row] of Object.entries(STAGE_TRANSITIONS)) {
      const expected = [...new Set([...row.next, ...row.accept, ...row.reject, ...row.rework])].sort();
      assert.deepEqual(
        [...parseNextStages(scratch, stage)].sort(),
        expected,
        `${stage} moves come from the catalog, not the prose mirror beside it`,
      );
    }
    assert.ok(!parseNextStages(scratch, "shape").includes("plan"), "the stub's bogus 'plan' edge is ignored");
    assert.deepEqual(parseNextStages(scratch, "unknown"), [], "an unlisted stage offers no moves");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Catalog validates clean as a state machine.
{
  const audit = auditStageCatalog(STAGE_CATALOG, { terminal: "audit" });
  assert.equal(audit.ok, true, `catalog strands no card: ${audit.findings.map((f) => `${f.stage}:${f.rule}`).join("; ")}`);
  assert.ok(STAGE_TRANSITIONS.shape.next.includes("critique"), "shape advances to critique from the catalog");
}

console.log("vocabulary freeze ok: one catalog, one compat map, catalog-driven advance");
