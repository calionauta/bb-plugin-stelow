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

// [stage, skillDir | "stages/<file>" | null for orchestrator fallback]
const STAGE_PLAYBOOKS = [
  ["triage", "stages/triage.md"],
  ["select", null],
  ["setup", "stages/setup.md"],
  ["context", "stages/context.md"],
  ["shape", "stelow-workflow-shape-up/SKILL.md"],
  ["critique", "stelow-workflow-plan-critique/SKILL.md"],
  ["gate", "stages/gate.md"],
  ["interface", "stelow-workflow-interface-alternatives/SKILL.md"],
  ["int-gate", null],
  ["selection", "stages/selection.md"],
  ["planning", "stelow-workflow-tech-planning/SKILL.md"],
  ["plan-gate", "stages/plan-gate.md"],
  ["execution", "stages/execution.md"],
  ["verification", "stages/verification.md"],
  ["diff-gate", "stages/diff-gate.md"],
  ["audit", "stelow-workflow-execution-critique/SKILL.md"],
];

export function stagePlaybookRelPath(stage) {
  const row = STAGE_PLAYBOOKS.find(([name]) => name === stage);
  if (!row) return null;
  return row[1];
}

export function knownStages() {
  return STAGE_PLAYBOOKS.map(([name]) => name);
}

// Build the ordered reading list. `exists` is injected (node fs on the
// host, tmp dirs in tests) so the listing logic is exercised against real
// I/O, never a mocked filesystem.
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
    const base = rel.startsWith("stages/") ? `${skillsDir}/stelow-workflow-orchestrator` : skillsDir;
    file(`stage(${stage})`, `${base}/${rel}`);
  }
  return entries;
}

export function renderPlaybook(entries) {
  const lines = entries.map((entry) => `${entry.label}: ${entry.path}${entry.missing ? "  (missing — broken install, report it, do not work around it)" : ""}`);
  return `${lines.join("\n")}\nRead in order. Do not search for alternatives.`;
}
