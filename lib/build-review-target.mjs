const GATE_ARTIFACT_STAGE = {
  gate: "shape",
  "int-gate": "interface",
  selection: "interface",
  "plan-gate": "planning",
};

function questionArtifact(detail) {
  return [...detail.pendingQuestions, ...detail.expiredQuestions]
    .flatMap((question) => question.options ?? [])
    .find((option) => option?.artifact)?.artifact ?? null;
}

function stageArtifact(detail, card) {
  const artifacts = detail.artifacts.filter((artifact) => artifact.role !== "evidence");
  const stage = GATE_ARTIFACT_STAGE[card.stage] ?? "";
  return artifacts.find((artifact) => artifact.stage === stage) ?? artifacts.at(-1) ?? null;
}

export function selectBuildReviewArtifact({ detail, card, heroKind }) {
  if (!detail || !card || (heroKind !== "decision" && detail.pendingQuestions.length === 0)) return null;
  return questionArtifact(detail) ?? stageArtifact(detail, card);
}
