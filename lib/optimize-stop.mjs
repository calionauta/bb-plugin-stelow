/**
 * Preconditions for an optimization pass — the stop rule up front.
 *
 * An optimize request without a named failure mode and a measurable target
 * is the drill Rauchg describes: unbounded hardening against input spaces
 * nobody will hit. So the gate refuses to start until three things exist:
 * the failure being fixed, the metric that proves it fixed, and an explicit
 * iteration bound (maxIterations 1-10). Stop rules ride along as scope
 * guards, never as the bound — a rule like "do not change the API" says
 * what not to touch, not when to stop. Pure: no I/O, no model. Returns
 * issues[]; empty means go. Opt-in: no caller wires it yet.
 */

export const MAX_OPTIMIZE_ITERATIONS = 10;

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateOptimizeRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return ["optimize request must be an object"];
  }
  const issues = [];
  if (!nonEmpty(request.failureMode)) {
    issues.push("optimize request requires failureMode");
  }
  if (!nonEmpty(request.metricTarget)) {
    issues.push("optimize request requires metricTarget");
  }
  const capped = request.maxIterations;
  if (capped === undefined || capped === null) {
    issues.push(`maxIterations is required: an integer 1-${MAX_OPTIMIZE_ITERATIONS}`);
  } else if (!Number.isInteger(capped) || capped < 1 || capped > MAX_OPTIMIZE_ITERATIONS) {
    issues.push(`maxIterations must be an integer 1-${MAX_OPTIMIZE_ITERATIONS}`);
  }
  if (request.stopRules !== undefined) {
    const rules = Array.isArray(request.stopRules) ? request.stopRules : [];
    if (rules.length === 0 || !rules.every(nonEmpty)) {
      issues.push("stopRules must be non-empty strings when present");
    }
  }
  return [...new Set(issues)];
}
