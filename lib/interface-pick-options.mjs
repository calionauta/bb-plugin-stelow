import { resolveInterfaceContrastRoute, validateInterfaceContrastReceipt } from "./interface-contrast.mjs";

/**
 * Contrast receipt → `interface-pick` ask options (owned contract).
 *
 * The `interface` stage always runs reaction-first Interface Contrast and
 * writes `interfaces/contrast.json` plus a readable `interfaces/*.md`
 * rendering. The `selection` stage owns the actual pick: a structured
 * `interface-pick` question when the `interface` review gate is selected,
 * an agent-recorded receipt otherwise. This module is the single seam
 * between the two: receipt options in, ask options out. It never invents
 * wireframes, coverage, or a winner — authority lives with the decider.
 */

const DEFAULT_ARTIFACT_PATH = "interfaces/interfaces.md";
const LABEL_CAP = 60;
const PREVIEW_ROW_CAP = 15;

const PICKABLE_ROUTES = new Set(["interface-refinement", "lean-single-proposal"]);

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function basename(path) {
  const parts = String(path).split("/");
  return parts[parts.length - 1] || String(path);
}

function destinationOf(receipt) {
  try {
    return resolveInterfaceContrastRoute(receipt).destination;
  } catch {
    return undefined;
  }
}

function coverageLines(option) {
  const coverage = Array.isArray(option.scopeCoverage) ? option.scopeCoverage : [];
  const served = coverage.filter((entry) => entry && entry.effect === "served" && text(entry.scopeId));
  const friction = coverage.filter((entry) => entry && entry.effect === "friction" && text(entry.scopeId));
  return { served, friction };
}

function scopeNames(entries) {
  return entries.map((entry) => (text(entry.note) ? `${entry.scopeId} (${entry.note.trim()})` : entry.scopeId)).join(", ");
}

function describeCoverage(option, receipt) {
  const { served, friction } = coverageLines(option);
  if (served.length === 0 && friction.length === 0) {
    const why = receipt.scopeMapVersion == null
      ? "scopeMapVersion missing"
      : `scope map ${receipt.scopeMapVersion} names none for this option`;
    return `No map recorded (${why}), so no coverage is claimed.`;
  }
  const parts = [];
  if (served.length > 0) parts.push(`Served: ${scopeNames(served)} (served scope${served.length > 1 ? "s" : ""}).`);
  if (friction.length > 0) parts.push(`Friction: ${scopeNames(friction)} (friction scope${friction.length > 1 ? "s" : ""}).`);
  return parts.join(" ");
}

function toDescription(option, receipt) {
  const related = Array.isArray(option.relatedValues) ? option.relatedValues.filter(text) : [];
  const relatedText = related.length > 0 ? ` Related: ${related.map((entry) => entry.trim()).join(", ")}.` : "";
  return `${option.primaryValue.trim()}.${relatedText} ${describeCoverage(option, receipt)}`;
}

function toPreview(option, receipt) {
  const lines = [];
  if (text(receipt.decisionQuestion)) lines.push(receipt.decisionQuestion.trim().split("\n")[0]);
  lines.push(option.primaryValue.trim().split("\n")[0]);
  const related = Array.isArray(option.relatedValues) ? option.relatedValues.filter(text) : [];
  if (related.length > 0) {
    const shown = related.slice(0, 5).map((entry) => entry.trim());
    lines.push(`Related: ${shown.join(", ")}${related.length > 5 ? ` (+${related.length - 5} more)` : ""}`);
  }
  const { served, friction } = coverageLines(option);
  for (const entry of served.slice(0, 3)) lines.push(`Serves ${entry.scopeId}${text(entry.note) ? ` — ${entry.note.trim()}` : ""}`);
  for (const entry of friction.slice(0, 3)) lines.push(`Friction ${entry.scopeId}${text(entry.note) ? ` — ${entry.note.trim()}` : ""}`);
  const hiddenScopes = served.length + friction.length - Math.min(served.length, 3) - Math.min(friction.length, 3);
  if (hiddenScopes > 0) lines.push(`(+${hiddenScopes} more scope lines in the artifact)`);
  if (Array.isArray(receipt.criteria) && receipt.criteria.some(text)) {
    lines.push(`Judged by: ${receipt.criteria.filter(text).map((entry) => entry.trim()).join("; ")}`);
  }
  return lines.slice(0, PREVIEW_ROW_CAP).join("\n");
}

function toAskOption(option, receipt, artifactPath) {
  return {
    label: option.id,
    description: toDescription(option, receipt),
    preview: toPreview(option, receipt),
    artifact: { path: artifactPath, display: basename(artifactPath) },
  };
}

/**
 * Map a contrast receipt to `interface-pick` ask options.
 *
 * Pickable only for `interface-refinement` / `lean-single-proposal` with
 * `generation-ready:continue`. Everything else refuses with a named reason
 * and the route-table destination — never an invented pick. Never throws.
 */
export function contrastPickOptions(receipt, { artifactPath = DEFAULT_ARTIFACT_PATH } = {}) {
  if (!plainObject(receipt)) return { refused: true, reason: "contrast receipt must be an object" };
  const issues = validateInterfaceContrastReceipt(receipt);
  if (issues.length > 0) return { refused: true, reason: `invalid contrast receipt: ${issues[0]}`, issues };
  if (receipt.route === "existing-interface-no-comparison") {
    return { refused: true, reason: "adopt-existing: a single existing interface needs no comparison pick", destination: destinationOf(receipt) };
  }
  const pickable = PICKABLE_ROUTES.has(receipt.route)
    && receipt.briefStatus === "generation-ready"
    && receipt.disposition === "continue";
  if (!pickable) {
    const pair = `${receipt.briefStatus}:${receipt.disposition}`;
    const reason = `not pickable: route ${receipt.route} with ${pair}`;
    return { refused: true, reason, destination: destinationOf(receipt) };
  }
  if (!Array.isArray(receipt.options) || receipt.options.length === 0) {
    return { refused: true, reason: "no options to pick from", destination: destinationOf(receipt) };
  }
  const longId = receipt.options.find((option) => !text(option.id) || option.id.length > LABEL_CAP);
  if (longId) {
    const clipped = `${(longId.id || "").slice(0, LABEL_CAP)}…`;
    const reason = `option id exceeds the ${LABEL_CAP}-char ask cap: ${clipped}`;
    return { refused: true, reason, destination: destinationOf(receipt) };
  }
  const path = text(artifactPath) ? artifactPath.trim() : DEFAULT_ARTIFACT_PATH;
  return { options: receipt.options.map((option) => toAskOption(option, receipt, path)) };
}
