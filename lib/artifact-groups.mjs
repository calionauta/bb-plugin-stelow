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

// Research has the same artifact-inventory shape as Build, but its durable
// grouping axis is a strategy round rather than a workflow stage. Round files
// come from the card's recorded history; index rows only enrich matching files
// with a human-friendly output name and note. The index can never invent an
// openable artifact by itself.
function normalizedPath(value) {
  return typeof value === "string" ? value.replace(/^\.\//, "").replace(/\/+$/, "").trim() : "";
}

export function groupResearchArtifacts(rounds, outputs) {
  const outputByPath = new Map();
  for (const output of Array.isArray(outputs) ? outputs : []) {
    const path = normalizedPath(output?.path);
    if (path && !outputByPath.has(path)) outputByPath.set(path, output);
  }
  return (Array.isArray(rounds) ? rounds : [])
    .filter((round) => Array.isArray(round?.files) && round.files.length > 0)
    .map((round) => ({
      id: `round-${round.n}-${round.strategyId}`,
      title: `Round ${round.n} — ${round.label}`,
      items: round.files.map((file) => {
        const output = outputByPath.get(normalizedPath(file.path));
        return {
          ...file,
          kind: "document",
          display: typeof output?.output === "string" && output.output.trim() ? output.output.trim() : file.display,
          note: typeof output?.notes === "string" && output.notes.trim() ? output.notes.trim() : null,
        };
      }),
    }));
}
