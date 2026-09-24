// Host-served playbook paths. Workers used to discover stage playbooks via
// `bb skill list | awk …` pipelines over content-hashed skill ids — flaky
// (leakguard blocks, name lookup fails) and wasteful (whole turns burned on
// discovery). The host knows every exact path, so it tells: `bb stelow
// playbook` prints the card's state file, transitions, and the ordered
// reading list for its current stage. Convention over configuration: the
// worker reads what it is given instead of searching the plugin.
//
// Stage coverage is explicit, not guessed. Stages with a dedicated file
// under the orchestrator list it; stages owned by a sibling skill list
// that skill; anything else falls back to the orchestrator SKILL.md, which
// indexes the sequence. Missing files are reported, never silently
// dropped — a broken install must fail loud.

import { STAGE_BY_ID, STAGE_SEQUENCE } from "./workflow-catalog.mjs";

export function stagePlaybookRelPath(stage) {
  return STAGE_BY_ID[stage]?.playbook ?? null;
}

export function knownStages() {
  return [...STAGE_SEQUENCE];
}

// Build the ordered reading list. `exists` is injected (node fs on the
// host, tmp dirs in tests) so the listing logic is exercised against real
// I/O, never a mocked filesystem.
function stageEntryBase({ stage, rel, skillsDir }) {
  const stageSkill = STAGE_BY_ID[stage]?.skill;
  if (rel.startsWith("stages/")) return `${skillsDir}/stelow-workflow-orchestrator`;
  if (rel === "SKILL.md" && stageSkill) return `${skillsDir}/${stageSkill}`;
  return skillsDir;
}

export function playbookEntries({ kind, stage, statePath, transitionsPath, skillsDir, strategySkill, exploreSkill, researchIndexPath, exploreArtifactPath }, exists) {
  const entries = [];
  const file = (label, path) => {
    entries.push({ label, path, missing: !exists(path) });
  };
  if (statePath) file("state", statePath);
  if (transitionsPath) file("transitions", transitionsPath);
  file("entry", `${skillsDir}/stelow-workflow-entry/SKILL.md`);
  file("router", `${skillsDir}/stelow-workflow-router/SKILL.md`);
  file("orchestrator", `${skillsDir}/stelow-workflow-orchestrator/SKILL.md`);
  if (kind === "research") {
    if (researchIndexPath) file("index", researchIndexPath);
    if (strategySkill) file("strategy", `${skillsDir}/${strategySkill}/SKILL.md`);
    return entries;
  }
  if (kind === "explore") {
    if (exploreArtifactPath) file("artifact", exploreArtifactPath);
    if (exploreSkill) file("technique", `${skillsDir}/${exploreSkill}/SKILL.md`);
    return entries;
  }
  const rel = stagePlaybookRelPath(stage);
  if (rel) {
    const base = stageEntryBase({ stage, rel, skillsDir });
    file(`stage(${stage})`, `${base}/${rel}`);
  }
  return entries;
}

export function renderPlaybook(entries) {
  const lines = entries.map((entry) => `${entry.label}: ${entry.path}${entry.missing ? "  (missing — broken install, report it, do not work around it)" : ""}`);
  return `${lines.join("\n")}\nRead in order. Do not search for alternatives.`;
}
