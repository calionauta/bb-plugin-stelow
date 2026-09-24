import { pendingReview } from "./board-list-presentation.mjs";

export function cardIsTerminal(card) {
  return card.status === "completed" || card.status === "archived" || card.status === "blocked";
}

export function cardCanResume(card) {
  return !cardIsTerminal(card)
    && Boolean(card.workerThreadId)
    && (card.activity === "error" || (card.activity === "idle" && card.needsAttention));
}

export function cardShowsAttention(card) {
  return card.needsAttention
    && card.activity !== "error"
    && card.activity !== "awaiting-answer";
}

export function cardNeedsReview(card) {
  return pendingReview(card);
}
