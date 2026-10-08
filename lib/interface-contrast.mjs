const ROUTES = new Set([
  "interface-refinement",
  "shape-contrast",
  "research-needed",
  "lean-single-proposal",
  "stop-and-name-decision",
  "human-or-shape-stop",
  "repair-focal-brief",
  "existing-interface-no-comparison",
  "repair-brief",
]);
const BRIEF_STATES = new Set(["generation-ready", "stop", "repair-brief", "no-comparison"]);
const DISPOSITIONS = new Set(["continue", "human-decision-required", "shape-required", "research-required", "repair-brief"]);
const EVIDENCE_SOURCES = new Set(["fixture", "scenario", "simulation", "measured", "human"]);

// One rule per route: where it sends the card, which artifacts go stale on the
// way, whether a human has to sign for it, and the brief/disposition pairs it
// accepts. The last one is the contract — an unlisted pair is a refusal, not a
// default.
const ROUTE_RULES = new Map([
  ["interface-refinement", {
    destination: "interface",
    staleArtifacts: [],
    requiresApproval: false,
    allowed: new Set(["generation-ready:continue", "repair-brief:repair-brief"]),
  }],
  ["shape-contrast", {
    destination: "shape",
    staleArtifacts: ["scope-map", "interface-contrasts", "selection"],
    requiresApproval: true,
    allowed: new Set(["stop:human-decision-required", "stop:shape-required"]),
  }],
  ["research-needed", {
    destination: "research",
    staleArtifacts: ["selection", "technical-plan"],
    requiresApproval: false,
    allowed: new Set(["stop:research-required"]),
  }],
  ["lean-single-proposal", {
    destination: "interface",
    staleArtifacts: [],
    requiresApproval: false,
    allowed: new Set(["generation-ready:continue"]),
  }],
  ["stop-and-name-decision", {
    destination: "human",
    staleArtifacts: ["scope-map", "interface-contrasts", "selection", "technical-plan"],
    requiresApproval: true,
    allowed: new Set(["stop:human-decision-required"]),
  }],
  ["human-or-shape-stop", {
    destination: "shape",
    staleArtifacts: ["scope-map", "interface-contrasts", "selection", "technical-plan"],
    requiresApproval: true,
    allowed: new Set(["stop:human-decision-required"]),
  }],
  ["repair-focal-brief", {
    destination: "interface",
    staleArtifacts: [],
    requiresApproval: false,
    allowed: new Set(["repair-brief:repair-brief"]),
  }],
  ["existing-interface-no-comparison", {
    destination: "interface",
    staleArtifacts: [],
    requiresApproval: false,
    allowed: new Set(["no-comparison:continue"]),
  }],
  ["repair-brief", {
    destination: "interface",
    staleArtifacts: [],
    requiresApproval: false,
    allowed: new Set(["repair-brief:repair-brief"]),
  }],
]);

export function resolveInterfaceContrastRoute(receipt) {
  const rule = ROUTE_RULES.get(receipt?.route);
  const pair = `${receipt?.briefStatus}:${receipt?.disposition}`;
  if (!rule || !rule.allowed.has(pair)) throw new Error(`route/disposition combination is invalid: ${receipt?.route ?? "unknown"} / ${pair}`);
  return { destination: rule.destination, staleArtifacts: [...rule.staleArtifacts], requiresApproval: rule.requiresApproval };
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function list(value, label, issues, { required = false } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return [];
  }
  if (required && value.length === 0) issues.push(`${label} must not be empty`);
  if (value.some((entry) => !text(entry))) issues.push(`${label} entries must be non-empty strings`);
  return value;
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableText(value) {
  return value === null || text(value);
}

/** One declared string list. An absent field is absent, not invalid. */
function checkDeclaredList(receipt, name, issues) {
  if (receipt[name] === undefined) return;
  list(receipt[name], name, issues);
}

function checkVersions(receipt, issues) {
  if (!text(receipt.shapeVersion)) issues.push("shapeVersion must be non-empty");
  if (receipt.scopeMapVersion != null && !text(receipt.scopeMapVersion)) issues.push("scopeMapVersion must be null or non-empty");
}

function checkBrief(receipt, issues) {
  if (receipt.briefStatus !== "generation-ready") return;
  if (!text(receipt.decisionQuestion)) issues.push("generation-ready requires decisionQuestion");
  if (!text(receipt.primaryDimension)) issues.push("generation-ready requires primaryDimension");
  if (!Array.isArray(receipt.criteria) || receipt.criteria.length < 2 || receipt.criteria.length > 4) {
    issues.push("generation-ready requires 2-4 criteria");
  }
  list(receipt.criteria, "criteria", issues);
}

function checkFixedConstraints(receipt, issues) {
  if (!Array.isArray(receipt.fixedConstraints)) {
    issues.push("fixedConstraints must be an array");
    return;
  }
  for (const [index, constraint] of receipt.fixedConstraints.entries()) {
    if (!constraint || !text(constraint.name) || !text(constraint.value) || !text(constraint.source)) {
      issues.push(`fixedConstraints[${index}] requires name, value, and source`);
    }
  }
}

function checkEvidence(receipt, issues) {
  if (!Array.isArray(receipt.evidence)) {
    issues.push("evidence must be an array");
    return;
  }
  for (const [index, item] of receipt.evidence.entries()) {
    if (!item || !EVIDENCE_SOURCES.has(item.source) || !text(item.reference) || !text(item.claim)) {
      issues.push(`evidence[${index}] requires a supported source, reference, and claim`);
    }
  }
  if (receipt.authority === "agent" && receipt.evidence.some((item) => item?.source === "human")) {
    issues.push("agent-authored receipts cannot carry human evidence");
  }
}

function checkOptions(receipt, issues) {
  if (receipt.briefStatus !== "generation-ready") return;
  const options = Array.isArray(receipt.options) ? receipt.options : [];
  if (options.length < 1 || options.length > 4) {
    issues.push("generation-ready requires 1-4 options");
  }
  for (const [index, option] of options.entries()) {
    const eligible = option && text(option.id) && text(option.primaryValue) && option.compatibility === "valid";
    if (!eligible) issues.push(`options[${index}] must be a valid eligible option`);
  }
}

// Seven fields the schema declares that the runtime validator accepted blind:
// `relatedDimensions`, `missingInputs`, `reshapeProof`, `invalidOptions`,
// `jobImportance`, `acceptedSacrifice` and `nextAction`. The first two and
// the last are the ones a reader acts on: an empty `nextAction` left the card
// with no next move to show, and a `missingInputs` that was a string instead
// of a list read as "no missing evidence" — the opposite of the truth. This
// is the same drift the parity test was written for, in the fields it did not
// yet cover. An absent field stays absent; a present one must match its
// declared type, because a silent no-op is how a receipt stops being evidence.
function checkDeclaredOptionals(receipt, issues) {
  checkDeclaredList(receipt, "relatedDimensions", issues);
  checkDeclaredList(receipt, "missingInputs", issues);
  const invalid = Array.isArray(receipt.invalidOptions) ? receipt.invalidOptions : [];
  if (receipt.invalidOptions !== undefined && !Array.isArray(receipt.invalidOptions)) {
    issues.push("invalidOptions must be an array");
  }
  for (const [index, entry] of invalid.entries()) {
    if (!plainObject(entry)) issues.push(`invalidOptions[${index}] must be an object`);
  }
  if (receipt.reshapeProof !== undefined && receipt.reshapeProof !== null && !plainObject(receipt.reshapeProof)) {
    issues.push("reshapeProof must be an object or null");
  }
  if (receipt.jobImportance !== undefined && !nullableText(receipt.jobImportance)) {
    issues.push("jobImportance must be a non-empty string or null");
  }
  if (receipt.acceptedSacrifice !== undefined && !nullableText(receipt.acceptedSacrifice)) {
    issues.push("acceptedSacrifice must be a non-empty string or null");
  }
  if (!text(receipt.nextAction)) issues.push("nextAction must be non-empty");
}

/**
 * Strict shape for discarded options — the incremental step toward recording
 * why the losers lost. The receipt-level check accepts any object so old
 * receipts keep validating; this one requires the fields a later agent needs
 * to argue with a discarded solution's funeral instead of resurrecting it:
 * a stable id, the reason it lost, and (when another decision retired it)
 * the id of the decision that did. Opt-in: no existing path calls it yet.
 */
export function validateInvalidOptionsStrict(invalidOptions) {
  if (invalidOptions === undefined) return [];
  if (!Array.isArray(invalidOptions)) return ["invalidOptions must be an array"];
  const issues = [];
  for (const [index, entry] of invalidOptions.entries()) {
    if (!plainObject(entry)) {
      issues.push(`invalidOptions[${index}] must be an object`);
      continue;
    }
    if (!text(entry.id)) issues.push(`invalidOptions[${index}] requires id`);
    if (!text(entry.reason)) issues.push(`invalidOptions[${index}] requires reason`);
    if (entry.retiredBy !== undefined && !text(entry.retiredBy)) {
      issues.push(`invalidOptions[${index}].retiredBy must be non-empty`);
    }
  }
  return [...new Set(issues)];
}

/**
 * The trail line for a resolved route.
 *
 * It lives here, not in the reconcile wiring, because the wording is the only
 * machine record of where a run decided to go and the wiring had no seam to
 * test it. `human` is a destination, not a stage: printing it bare left the
 * reader hunting for a stage that does not exist, so the line says what it is.
 */
export function describeInterfaceContrastRoute(receipt) {
  const route = resolveInterfaceContrastRoute(receipt);
  const destination = route.destination === "human"
    ? "human (not a stage — the worker asks on the card)"
    : route.destination;
  return {
    destination: route.destination,
    requiresApproval: route.requiresApproval,
    note: `Interface Contrast route: ${destination}; stale artifacts: ${route.staleArtifacts.join(", ") || "none"}.`,
  };
}

export function validateInterfaceContrastReceipt(receipt) {
  const issues = [];
  if (!plainObject(receipt)) return ["Interface Contrast receipt must be an object"];
  if (receipt.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (!text(receipt.receiptId)) issues.push("receiptId must be non-empty");
  if (!ROUTES.has(receipt.route)) issues.push("route is not supported");
  if (!BRIEF_STATES.has(receipt.briefStatus)) issues.push("briefStatus is not supported");
  if (!DISPOSITIONS.has(receipt.disposition)) issues.push("disposition is not supported");
  if (!["agent", "human"].includes(receipt.authority)) issues.push("authority must be agent or human");
  if (ROUTES.has(receipt.route)) {
    try {
      resolveInterfaceContrastRoute(receipt);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "route/disposition combination is invalid");
    }
  }
  checkVersions(receipt, issues);
  checkBrief(receipt, issues);
  checkFixedConstraints(receipt, issues);
  checkEvidence(receipt, issues);
  checkOptions(receipt, issues);
  checkDeclaredOptionals(receipt, issues);
  return [...new Set(issues)];
}

export function validateHumanBoundary(boundary) {
  const issues = [];
  if (!boundary || typeof boundary !== "object" || Array.isArray(boundary)) return ["human boundary must be an object"];
  if (!text(boundary.contractId)) issues.push("contractId must be non-empty");
  if (!text(boundary.boundaryId)) issues.push("boundaryId must be non-empty");
  if (!["reaction", "confirmation"].includes(boundary.kind)) issues.push("kind must be reaction or confirmation");
  if (!["open", "answered"].includes(boundary.status)) issues.push("status must be open or answered");
  if (!text(boundary.shapeVersion)) issues.push("shapeVersion must be non-empty");
  if (boundary.scopeMapVersion != null && !text(boundary.scopeMapVersion)) issues.push("scopeMapVersion must be null or non-empty");
  if (boundary.status === "answered" && !text(boundary.answer)) issues.push("answered boundary requires an answer");
  return [...new Set(issues)];
}

export function assertBoundaryAnswerCurrent(currentVersions, answer) {
  return answer?.status === "answered"
    && text(answer.shapeVersion)
    && text(currentVersions?.shapeVersion)
    && answer.shapeVersion === currentVersions.shapeVersion
    && (answer.scopeMapVersion ?? null) === (currentVersions?.scopeMapVersion ?? null);
}
