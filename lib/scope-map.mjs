import { cleanTrackableId } from "./trackables.mjs";

const MAP_STATUSES = new Set(["draft", "approved"]);
const SCOPE_STATUSES = new Set(["current", "stale", "blocked", "unknown"]);
const CHALLENGE_KINDS = new Set(["scope-boundary", "dependency-change", "product-commitment"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value, label, issues, { required = false } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return [];
  }
  if (required && value.length === 0) issues.push(`${label} must not be empty`);
  if (value.some((entry) => !nonEmptyString(entry))) issues.push(`${label} entries must be non-empty strings`);
  return value.filter(nonEmptyString);
}

function visitScope(id, dependencies, visiting, visited, issues) {
  if (visiting.has(id)) {
    issues.push(`scope dependency cycle includes ${id}`);
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of dependencies.get(id) ?? []) visitScope(dependency, dependencies, visiting, visited, issues);
  visiting.delete(id);
  visited.add(id);
}

export function validateScopeMap(map) {
  const issues = [];
  if (!map || typeof map !== "object" || Array.isArray(map)) return ["scope map must be an object"];
  if (map.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (!cleanTrackableId(map.mapId)) issues.push("mapId must be a canonical identifier");
  if (!MAP_STATUSES.has(map.status)) issues.push("status must be draft or approved");
  if (!nonEmptyString(map.shapeVersion)) issues.push("shapeVersion must be non-empty");
  stringList(map.provenance, "provenance", issues, { required: true });
  stringList(map.openDecisions, "openDecisions", issues);
  if (map.status === "approved") {
    if (!map.approval || typeof map.approval !== "object") issues.push("approved map requires approval");
    else {
      if (!nonEmptyString(map.approval.receiptId)) issues.push("approved map requires approval.receiptId");
      if (!nonEmptyString(map.approval.approvedBy)) issues.push("approved map requires approval.approvedBy");
    }
  }
  if (!Array.isArray(map.scopes) || map.scopes.length === 0) {
    issues.push("scopes must contain at least one scope");
    return issues;
  }
  if (map.scopes.length > 100) issues.push("scopes must contain at most 100 scopes");

  const ids = new Set();
  const dependencies = new Map();
  for (const [index, scope] of map.scopes.entries()) {
    const label = `scopes[${index}]`;
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
      issues.push(`${label} must be an object`);
      continue;
    }
    if (!cleanTrackableId(scope.id)) issues.push(`${label}.id must be a canonical identifier`);
    else if (ids.has(scope.id)) issues.push(`${label}.id duplicates ${scope.id}`);
    else ids.add(scope.id);
    if (!nonEmptyString(scope.title)) issues.push(`${label}.title must be non-empty`);
    if (!nonEmptyString(scope.outcome)) issues.push(`${label}.outcome must be non-empty`);
    if (!SCOPE_STATUSES.has(scope.status)) issues.push(`${label}.status must be current, stale, blocked, or unknown`);
    stringList(scope.capabilities, `${label}.capabilities`, issues, { required: true });
    stringList(scope.inScope, `${label}.inScope`, issues, { required: true });
    stringList(scope.outOfScope, `${label}.outOfScope`, issues);
    const dependsOn = stringList(scope.dependsOn, `${label}.dependsOn`, issues);
    if (new Set(dependsOn).size !== dependsOn.length) issues.push(`${label}.dependsOn must not contain duplicates`);
    if (dependsOn.includes(scope.id)) issues.push(`${label}.dependsOn must not reference itself`);
    dependencies.set(scope.id, dependsOn);
  }
  for (const [scopeId, dependsOn] of dependencies) {
    for (const dependency of dependsOn) {
      if (!ids.has(dependency)) issues.push(`${scopeId}.dependsOn references unknown scope ${dependency}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  for (const id of ids) visitScope(id, dependencies, visiting, visited, issues);
  return [...new Set(issues)];
}

export function scopeMapFreshness(map, { currentShapeVersion } = {}) {
  if (!nonEmptyString(currentShapeVersion) || map?.shapeVersion !== currentShapeVersion) return { state: "stale", stale: true };
  return { state: "current", stale: false };
}

export function validateScopeMapChallenge(challenge) {
  const issues = [];
  if (!challenge || typeof challenge !== "object" || Array.isArray(challenge)) return ["scope map challenge must be an object"];
  if (challenge.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (!cleanTrackableId(challenge.challengeId)) issues.push("challengeId must be a canonical identifier");
  if (!cleanTrackableId(challenge.mapId)) issues.push("mapId must be a canonical identifier");
  if (!nonEmptyString(challenge.mapShapeVersion)) issues.push("mapShapeVersion must be non-empty");
  if (!CHALLENGE_KINDS.has(challenge.kind)) issues.push("kind is not a supported challenge kind");
  stringList(challenge.affectedScopeIds, "affectedScopeIds", issues, { required: true });
  if (!nonEmptyString(challenge.reason)) issues.push("reason must be non-empty");
  if (!["continue", "human-decision-required", "shape-required", "research-required", "repair-brief"].includes(challenge.disposition)) issues.push("disposition is not supported");
  const allowedDispositions = challenge.kind === "product-commitment"
    ? new Set(["human-decision-required", "shape-required"])
    : new Set(["continue", "human-decision-required", "repair-brief"]);
  if (challenge.kind && !allowedDispositions.has(challenge.disposition)) issues.push("disposition is not valid for the challenge kind");
  if (!["agent", "human"].includes(challenge.authority)) issues.push("authority must be agent or human");
  stringList(challenge.evidence, "evidence", issues, { required: true });
  if (!nonEmptyString(challenge.requestedBy)) issues.push("requestedBy must be non-empty");
  return [...new Set(issues)];
}

export function resolveScopeMapChallenge(challenge) {
  const issues = validateScopeMapChallenge(challenge);
  if (issues.length) throw new Error(`scope map challenge cannot route: ${issues.join("; ")}`);
  const destination = challenge.kind === "product-commitment" ? "shape" : "scope";
  return {
    destination,
    staleArtifacts: destination === "shape"
      ? ["scope-map", "technical-plan", "selection"]
      : ["scope-map", "technical-plan"],
    requiresApproval: true,
  };
}

export function projectScopeMapToTracking(map) {
  const issues = validateScopeMap(map);
  if (map?.status !== "approved") issues.push("only an approved scope map can become execution tracking");
  if (issues.length) throw new Error(`scope map cannot be projected: ${issues.join("; ")}`);
  return {
    mapId: map.mapId,
    shapeVersion: map.shapeVersion,
    scopes: map.scopes.map((scope) => ({
      id: scope.id,
      name: scope.title,
      status: "pending",
      blockedBy: [...scope.dependsOn],
    })),
  };
}
