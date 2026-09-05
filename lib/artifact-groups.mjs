/**
 * Deterministic grouping for the artifact inventory. Stages the workflow
 * knows (STAGE_SEQUENCE order) come first in sequence order; anything else
 * (research, interface, future stages, stageless "other") follows
 * alphabetically. Pure so the order users scan is pinned by a unit test
 * instead of render luck.
 * STAGE_SEQUENCE mirrors the canonical order (stages.yaml); the app imports
 * it from here instead of keeping a second copy.
 */

export const STAGE_SEQUENCE = [
  "triage", "select", "setup", "context", "shape", "critique", "gate",
  "scope", "interface", "int-gate", "selection", "planning", "plan-gate",
  "execution", "verification", "diff-gate", "audit",
];

export function groupArtifactsByStage(artifacts) {
  const groups = new Map();
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const stage = artifact && typeof artifact.stage === "string" && artifact.stage ? artifact.stage : "other";
    if (!groups.has(stage)) groups.set(stage, []);
    groups.get(stage).push(artifact);
  }
  const rank = (stage) => {
    const index = STAGE_SEQUENCE.indexOf(stage);
    return index >= 0 ? index : STAGE_SEQUENCE.length;
  };
  return [...groups.entries()].sort(([a], [b]) => {
    const diff = rank(a) - rank(b);
    return diff !== 0 ? diff : String(a).localeCompare(String(b));
  }).map(([stage, items]) => ({ stage, items }));
}
