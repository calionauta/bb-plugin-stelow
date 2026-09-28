import { resolveInterfaceContrastRoute } from "./interface-contrast.mjs";

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
 * The stale-artifact list a stop leaves behind, derived from the route table
 * that already owns it.
 *
 * It was read off the receipt's own `staleArtifacts` field, which no receipt
 * can legally carry: the contrast schema sets `additionalProperties: false`
 * and never declares the field. Every stop therefore reported `[]`, and the
 * card was told nothing became stale on its way to a human decision. The route
 * table is the single authority; a second copy in the artifact could only drift.
 *
 * Null means "this receipt is not a route the table recognises", and the
 * caller treats null as no stop: fail-closed, like every other branch here.
 */
function derivedStaleArtifacts(receipt) {
  try {
    return resolveInterfaceContrastRoute(receipt).staleArtifacts;
  } catch {
    return null;
  }
}

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
  // The route table only admits `stop:human-decision-required`, so a brief
  // that claims to be generation-ready cannot be a deliberate stop. Checking
  // it here keeps the derivation below total instead of throwing.
  if (receipt.briefStatus !== "stop") return { stop: false, reason: "brief-not-stopped" };
  const question = typeof receipt.decisionQuestion === "string" ? receipt.decisionQuestion.trim() : "";
  if (question.length === 0) return { stop: false, reason: "no-decision-question" };
  const stale = derivedStaleArtifacts(receipt);
  if (stale === null) return { stop: false, reason: "unrecognised-route" };
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
