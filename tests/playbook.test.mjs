import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knownStages, playbookEntries, renderPlaybook, stagePlaybookRelPath } from "../lib/playbook.mjs";

// Regression: workers discovered stage playbooks via `bb skill list | awk`
// pipelines over content-hashed ids — flaky and wasteful. The host serves
// exact paths; the table below is the whole mapping, with a loud fallback.

// Explicit coverage first: every machine stage resolves somewhere, and the
// table agrees with the files actually vendored.
const STAGES = ["triage", "select", "setup", "context", "shape", "critique", "gate", "interface", "int-gate", "selection", "planning", "plan-gate", "execution", "verification", "diff-gate", "audit"];
assert.deepEqual(knownStages().sort(), STAGES.slice().sort(), "every machine stage has a playbook row");
assert.equal(stagePlaybookRelPath("shape"), "stelow-workflow-shape-up/SKILL.md", "skill-owned stages point at the skill");
assert.equal(stagePlaybookRelPath("context"), "stages/context.md", "file-owned stages point at the file");
assert.equal(stagePlaybookRelPath("select"), null, "stages without a dedicated file fall back to the orchestrator");
assert.equal(stagePlaybookRelPath("nope"), null, "unknown stages fall back instead of inventing a path");

// Real I/O: entries resolve against a real directory tree, never a mock.
const root = mkdtempSync(join(tmpdir(), "playbook-"));
const skills = join(root, "skills");
mkdirSync(join(skills, "stelow-workflow-entry"), { recursive: true });
mkdirSync(join(skills, "stelow-workflow-router"), { recursive: true });
mkdirSync(join(skills, "stelow-workflow-orchestrator", "stages"), { recursive: true });
mkdirSync(join(skills, "stelow-workflow-shape-up"), { recursive: true });
for (const file of ["stelow-workflow-entry/SKILL.md", "stelow-workflow-router/SKILL.md", "stelow-workflow-orchestrator/SKILL.md", "stelow-workflow-orchestrator/stages/context.md", "stelow-workflow-shape-up/SKILL.md"]) {
  writeFileSync(join(skills, file), "# playbook\n");
}
const { existsSync } = await import("node:fs");

const build = playbookEntries({ kind: "build", stage: "shape", statePath: join(root, "state.md"), transitionsPath: join(root, "transitions.md"), skillsDir: skills }, existsSync);
assert.deepEqual(build.map((entry) => entry.label), ["state", "transitions", "entry", "router", "orchestrator", "stage(shape)"], "build order is fixed: state, transitions, core skills, stage");
assert.ok(build.every((entry) => entry.missing === false || entry.label === "state" || entry.label === "transitions"), "vendored skill files resolve; workspace files report honestly");

const fallback = playbookEntries({ kind: "build", stage: "int-gate", statePath: join(root, "state.md"), transitionsPath: join(root, "transitions.md"), skillsDir: skills }, existsSync);
assert.ok(fallback.every((entry) => entry.label !== "stage(int-gate)"), "a stage without a file lists no stage row");

const research = playbookEntries({ kind: "research", stage: null, statePath: join(root, "state.md"), transitionsPath: join(root, "transitions.md"), skillsDir: skills, strategySkill: "stelow-product-discovery", researchIndexPath: join(root, "research-index.md") }, existsSync);
assert.deepEqual(research.map((entry) => entry.label), ["state", "transitions", "entry", "router", "orchestrator", "index", "strategy"], "research lists index + strategy, never a stage");
assert.equal(research.find((entry) => entry.label === "strategy").missing, true, "an unsynced strategy skill reports missing instead of silently dropping");

const text = renderPlaybook(build);
assert.ok(text.includes("state: ") && text.includes("stage(shape): "), "rendered playbook names its rows");
assert.ok(text.endsWith("Read in order. Do not search for alternatives."), "rendered playbook closes discovery");
assert.ok(renderPlaybook(research).includes("(missing — broken install"), "missing files fail loud in the render");

console.log("playbook test ok: stage table, ordered entries, real I/O, loud missing files");
