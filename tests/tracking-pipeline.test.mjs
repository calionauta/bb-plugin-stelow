import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { countScopeDialects, diagnoseScopeSync, mergePlannedTasks } from "../lib/spec-scope-reader.mjs";
import { advanceExecutionGates, doneBuildGates } from "../lib/build-gates.mjs";
import { buildRegistry, dependencyCycles, canClose } from "../lib/trackable-relations.mjs";
import { contractRelPath, parseEvidenceContract, evidenceConditions } from "../lib/trackable-evidence.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";

// Exploratory pipeline test over real files (not mocks): a tmp project
// with stelow.json + plans + scope contracts, exercised through the same
// lib chain the server wires (diagnose → refuse → merge → registry →
// conditions → done). Two scenarios: the card_pttx9ion incident replay
// (human spec, zero synced scopes) and the healthy path.
const root = mkdtempSync(join(tmpdir(), "stelow-pipeline-"));
try {
  const stateRel = ".stelow/2026-09-21/sw-card1";
  mkdirSync(join(root, stateRel, "plans"), { recursive: true });
  mkdirSync(join(root, stateRel, "scopes"), { recursive: true });

  // --- Scenario A: incident replay (human headings, nothing synced) ---
  const humanSpec = `## 1. Identified Scopes\n\n### SCOPE-1: Overlay split\n\n| # | Task | Components | Risk | Done Criterion | Order Rationale |\n|---|------|-----------|------|---------------|-----------------|\n| 1.1 | Split root | ui-overlay | LOW (2) | Root renders alone | P2: enabler |\n`;
  writeFileSync(join(root, stateRel, "plans", "spec-tech_v1.md"), humanSpec);
  writeFileSync(join(root, "stelow.json"), JSON.stringify({
    workflows: [{ workflowId: "card1", dirHash: "sw-card1", created: "2026-09-21T00:00:00.000Z", status: "in-progress", scopes: [] }],
  }));
  const trackingA = JSON.parse(readFileSync(join(root, "stelow.json"), "utf8"));
  const specA = readFileSync(join(root, stateRel, "plans", "spec-tech_v1.md"), "utf8");
  assert.deepEqual(countScopeDialects(specA), { machine: 0, human: 1 }, "real file counts human");
  assert.equal(diagnoseScopeSync({ specContent: specA, syncedCount: trackingA.workflows[0].scopes.length }).state, "human-dialect", "real files diagnose the incident");
  assert.match(
    advanceExecutionGates({ kind: "build", stage: "execution", specContent: specA, syncedCount: 0 }).refusal ?? "",
    /human headings/,
    "real files refuse execution entry",
  );
  assert.match(
    doneBuildGates({ kind: "build", stage: "audit", scopes: [], specMachine: 0, specHuman: 1 }) ?? "",
    /human headings/,
    "real files refuse done",
  );

  // --- Scenario B: healthy path (machine spec, synced, contracted, verified) ---
  const machineSpec = `[SCOPE-1] Overlay split\n[TYPE] feature\nDependencies: none\n\n| # | Task | Components | Risk | Done Criterion | Order Rationale |\n|---|------|-----------|------|---------------|-----------------|\n| 1.1 | Split root | ui-overlay | LOW (2) | Root renders alone | P2: enabler |\n`;
  writeFileSync(join(root, stateRel, "plans", "spec-tech_v2.md"), machineSpec);
  writeFileSync(join(root, stateRel, "scopes", "scope-1.json"), JSON.stringify({
    acceptance_criteria: ["Root renders alone"],
    verify_commands: ["npm test"],
    target_files: ["components/ui/overlay.tsx"],
  }));
  const trackedB = [{
    id: "scope-1", name: "Overlay split", status: "in-progress", type: "feature",
    targetFiles: ["components/ui/overlay.tsx"],
    record: { verified: false, files_count: 2, commands_count: 1 },
    tasks: [{ id: "1.1", name: "Split root", status: "in-progress", source: "planned" }],
  }];
  const specB = readFileSync(join(root, stateRel, "plans", "spec-tech_v2.md"), "utf8");
  assert.equal(diagnoseScopeSync({ specContent: specB, syncedCount: trackedB.length }).state, "ok", "synced real files read ok");
  assert.deepEqual(advanceExecutionGates({ kind: "build", stage: "execution", specContent: specB, syncedCount: trackedB.length }), { refusal: null, note: null }, "healthy entry passes");
  const merged = mergePlannedTasks(trackedB, specB);
  assert.equal(merged[0].tasks.length, 1, "seeded planned task dedupes by name against the table");
  assert.equal(merged[0].tasks[0].status, "in-progress", "tracked progress survives the merge");
  const contractPath = contractRelPath(stateRel, "scope", "scope-1");
  assert.equal(contractPath, `${stateRel}/scopes/scope-1.json`, "contract resolves through the uniform layout");
  const contract = parseEvidenceContract(readFileSync(join(root, contractPath), "utf8"));
  assert.deepEqual(contract.acceptanceCriteria, ["Root renders alone"], "real contract file parses");
  const registry = buildRegistry(merged.map((scope) => ({ ...scope, contract })));
  assert.deepEqual(dependencyCycles(registry), [], "healthy graph acyclic");
  assert.equal(canClose(registry.get("scope-1"), registry), false, "open child blocks close on real data");
  const conditions = evidenceConditions({ entry: { ...merged[0], contract }, registry, claimed: true });
  assert.deepEqual(conditions.map((condition) => condition.type), [], "in-progress with claims and contract carries nothing");
  const doneEntry = { ...merged[0], contract, status: "done", tasks: [{ id: "1.1", name: "Split root", status: "done" }], record: { verified: true } };
  assert.deepEqual(evidenceConditions({ entry: doneEntry, registry: buildRegistry([doneEntry]) }), [], "verified close with contract carries nothing");
  assert.ok(isDoneStatus(doneEntry.status), "done reads done at the end of the line");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("tracking pipeline test ok: incident replay and healthy path over real files");
