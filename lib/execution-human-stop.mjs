/**
 * Does this run STOP to ask the human, or is it genuinely broken?
 *
 * Context: an Interface Contrast run can legitimately end by naming a
 * decision instead of producing a full brief — route `stop-and-name-decision`
 * with `authority: human` and `disposition: human-decision-required`. The
 * worker did the right thing. The host used to see "no valid artifact",
 * record `failed` / `artifact-malformed`, and leave the card in "Working"
 * forever with the decision question nowhere on screen — a wait with no
 * visible question behind it, which is the one thing the product forbids.
 *
 * Deciding that here, in lib/, keeps the rule testable without a database and
 * keeps it out of the reconcile wiring the refactor is busy slicing.
 *
 * Fail-closed on unknown shapes: anything we cannot positively recognise as
 * a deliberate stop stays a failure. Guessing "stop" for a broken run would
 * park the card forever.
 */

const HUMAN_DECISION_ROUTES = new Set([
  "stop-and-name-decision",
  "human-or-shape-stop",
  "shape-contrast",
]);

/**
 * Classify a recipe's parsed output for a deliberate human stop.
 *
 * @param {string} path artifact path, e.g. "interfaces/contrast.json"
 * @param {unknown} value parsed artifact content
 * @returns {{ stop: true, question: string, route: string, staleArtifacts: string[] } | { stop: false, reason: string }}
 */
export function humanStopRequest(path, value) {
  if (path !== "interfaces/contrast.json") return { stop: false, reason: "not-a-decision-artifact" };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { stop: false, reason: "receipt-not-an-object" };
  }
  const receipt = value;
  const route = typeof receipt.route === "string" ? receipt.route : "";
  if (!HUMAN_DECISION_ROUTES.has(route)) return { stop: false, reason: `route-${route || "unknown"}` };
  if (receipt.authority !== "human") return { stop: false, reason: "authority-not-human" };
  if (receipt.disposition !== "human-decision-required") {
    return { stop: false, reason: `disposition-${String(receipt.disposition)}` };
  }
  const question = typeof receipt.decisionQuestion === "string" ? receipt.decisionQuestion.trim() : "";
  if (question.length === 0) return { stop: false, reason: "no-decision-question" };
  const stale = Array.isArray(receipt.staleArtifacts)
    ? receipt.staleArtifacts.filter((entry) => typeof entry === "string")
    : [];
  return { stop: true, question, route, staleArtifacts: stale };
}

/**
 * The card-facing wording for a deliberate stop. The human must be able to
 * tell "the run is asking me something" from "the run broke" without
 * reading the trail, so the question is quoted verbatim rather than
 * summarized — the worker chose these words on purpose.
 */
export function humanStopMessage(stop) {
  return [
    "A native run stopped to ask for your decision — it did not fail.",
    `It asks: ${stop.question}`,
    "The run stays paused until you answer on the card; the stage does not advance on its own.",
  ].join(" ");
}
