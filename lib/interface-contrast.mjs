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

export function validateInterfaceContrastReceipt(receipt) {
  const issues = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return ["Interface Contrast receipt must be an object"];
  if (receipt.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (!text(receipt.receiptId)) issues.push("receiptId must be non-empty");
  if (!ROUTES.has(receipt.route)) issues.push("route is not supported");
  if (!BRIEF_STATES.has(receipt.briefStatus)) issues.push("briefStatus is not supported");
  if (!DISPOSITIONS.has(receipt.disposition)) issues.push("disposition is not supported");
  if (ROUTES.has(receipt.route)) {
    try {
      resolveInterfaceContrastRoute(receipt);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "route/disposition combination is invalid");
    }
  }
  if (!text(receipt.shapeVersion)) issues.push("shapeVersion must be non-empty");
  if (receipt.scopeMapVersion != null && !text(receipt.scopeMapVersion)) issues.push("scopeMapVersion must be null or non-empty");
  if (receipt.briefStatus === "generation-ready" && !text(receipt.decisionQuestion)) issues.push("generation-ready requires decisionQuestion");
  if (receipt.briefStatus === "generation-ready" && !text(receipt.primaryDimension)) issues.push("generation-ready requires primaryDimension");
  if (!Array.isArray(receipt.fixedConstraints)) issues.push("fixedConstraints must be an array");
  for (const [index, constraint] of (receipt.fixedConstraints ?? []).entries()) {
    if (!constraint || !text(constraint.name) || !text(constraint.value) || !text(constraint.source)) {
      issues.push(`fixedConstraints[${index}] requires name, value, and source`);
    }
  }
  if (receipt.briefStatus === "generation-ready") {
    if (!Array.isArray(receipt.criteria) || receipt.criteria.length < 2 || receipt.criteria.length > 4) issues.push("generation-ready requires 2-4 criteria");
    list(receipt.criteria, "criteria", issues);
  }
  if (!Array.isArray(receipt.evidence)) issues.push("evidence must be an array");
  for (const [index, item] of (receipt.evidence ?? []).entries()) {
    if (!item || !EVIDENCE_SOURCES.has(item.source) || !text(item.reference) || !text(item.claim)) {
      issues.push(`evidence[${index}] requires a supported source, reference, and claim`);
    }
  }
  const humanEvidence = (receipt.evidence ?? []).some((item) => item?.source === "human");
  if (receipt.authority === "agent" && humanEvidence) {
    issues.push("agent-authored receipts cannot carry human evidence");
  }
  if (!["agent", "human"].includes(receipt.authority)) issues.push("authority must be agent or human");
  if (receipt.briefStatus === "generation-ready") {
    if (!Array.isArray(receipt.options) || receipt.options.length < 1 || receipt.options.length > 4) issues.push("generation-ready requires 1-4 options");
    for (const [index, option] of (receipt.options ?? []).entries()) {
      const eligible = option && text(option.id) && text(option.primaryValue)
        && option.compatibility === "valid";
      if (!eligible) issues.push(`options[${index}] must be a valid eligible option`);
    }
  }
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
