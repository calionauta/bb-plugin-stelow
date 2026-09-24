import { joinStrategyLabels } from "./detail-presentation.mjs";
import { stageLabel } from "./workflow-vocabulary.mjs";

function withProgress(meta, summary) {
  if (summary.scopesTotal <= 0) return meta;
  return `${meta} · ✓ ${summary.scopesDone}/${summary.scopesTotal} scopes · ${summary.tasksDone}/${summary.tasksTotal} tasks`;
}

export function buildListMeta(card) {
  const state = card.status === "completed" ? "Completed" : stageLabel(card.stage);
  return withProgress(state, card.scopeSummary);
}

export function researchListMeta(card, strategyLabelById) {
  return joinStrategyLabels(card.researchStrategies ?? [], strategyLabelById);
}

export function exploreListMeta(card, stageLabelById) {
  if (!card.exploreStage) return null;
  return stageLabelById.get(card.exploreStage) ?? card.exploreStage;
}
