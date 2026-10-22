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
import { dirname } from "node:path";
import { stateDirFileEntries, stateDirSubdirEntries, workspaceFileEntries } from "./state-dir-files.mjs";

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

/**
 * The card's own files, in reading order: `state.md`, then the workspace's
 * transitions file, then every other fixed-name receipt in the state dir.
 *
 * Kept out of `playbookEntries` so each function stays small enough to read.
 * The dir is derived from `statePath` when a caller passes only that: the two
 * are the same directory by construction, so accepting one is enough and a
 * caller that forgets the other cannot silently lose every fixed-name row.
 */
function cardFileEntries({ stateDir, statePath, transitionsPath, workspaceRoot }, exists) {
  const dir = stateDir ?? (statePath ? dirname(statePath) : null);
  const fixed = dir ? stateDirFileEntries(dir, exists) : [];
  const entries = fixed.filter((entry) => entry.label === "state");
  if (transitionsPath) entries.push({ label: "transitions", path: transitionsPath, missing: !exists(transitionsPath) });
  entries.push(...fixed.filter((entry) => entry.label !== "state"));
  // The layout, last: a worker that is told which directories exist does not
  // need to `ls` or `find` to discover them.
  entries.push(...stateDirSubdirEntries(dir));
  // Workspace-root host files last: they sit outside the state dir, so they
  // belong after everything the card keeps inside it.
  entries.push(...workspaceFileEntries(workspaceRoot));
  return entries;
}

/**
 * The current run's rows: its root, what the recipe declares it should have
 * written, and what the host found it actually wrote.
 *
 * The root answers "where does my work go". `run-output` answers "what should be
 * here". `run-file` answers "what IS here" — the question that made workers run
 * `find <run> -type f`, 184 of 225 run-dir commands across the live threads. A
 * file present but undeclared appears only as a run-file row, and a declared
 * file that is absent simply does not appear, which is the honest reading of a
 * run whose staging was already cleaned up.
 *
 * None of these carries a missing-file verdict: a run that has not written yet
 * is not a broken install.
 */
function runEntries(run) {
  if (!run?.artifactRoot) return [];
  const rows = [{ label: "run", path: run.artifactRoot, missing: false }];
  for (const output of run.outputs ?? []) {
    rows.push({ label: "run-output", path: `${run.artifactRoot}/${output}`, missing: false });
  }
  for (const path of run.present ?? []) {
    rows.push({ label: "run-file", path: `${run.artifactRoot}/${path}`, missing: false });
  }
  return rows;
}

export function playbookEntries({
  kind,
  stage,
  stateDir,
  statePath,
  transitionsPath,
  workspaceRoot,
  skillsDir,
  strategySkill,
  exploreSkill,
  researchIndexPath,
  exploreArtifactPath,
  run,
}, exists) {
  const entries = cardFileEntries({ stateDir, statePath, transitionsPath, workspaceRoot }, exists);
  const file = (label, path) => {
    entries.push({ label, path, missing: !exists(path) });
  };
  file("entry", `${skillsDir}/stelow-workflow-entry/SKILL.md`);
  file("router", `${skillsDir}/stelow-workflow-router/SKILL.md`);
  file("orchestrator", `${skillsDir}/stelow-workflow-orchestrator/SKILL.md`);
  // The current run's artifact root and the files its recipe will write.
  // Printed last because they are the answer to "where does my work go", and
  // printed at all because the worker used to answer it with `find`/`ls`/`grep`
  // — 247 of 3348 live commands reference a run dir or an `exec_` id. These are
  // EXPECTED files, so they are listed without the missing-file verdict: a run
  // that has not written yet is not a broken install.
  entries.push(...runEntries(run));
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
