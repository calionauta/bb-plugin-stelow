/**
 * Host-neutral execution contract.
 *
 * The host control plane selects a native adapter by capability negotiation.
 * It never imports a host SDK, reads a native status table, or treats missing
 * support as success. Coordinator-owned sequential execution is a separate
 * route, not a synthetic native adapter.
 */

export const NORMALIZED_STATES = ["queued", "running", "needs_input", "succeeded", "failed", "cancelled"];
export const EXECUTION_CAPABILITIES = [
  "fanout", "pipeline", "structured-output", "durable-run", "resume", "cancel",
  "status", "hidden-workers", "human-input", "per-call-model",
  "per-call-permission", "isolated-workspace", "file-claims",
];
const KNOWN_CAPABILITIES = new Set(EXECUTION_CAPABILITIES);

function normalizeState(value) {
  const state = String(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (NORMALIZED_STATES.includes(state)) return state;
  if (["pending", "created", "accepted"].includes(state)) return "queued";
  if (["complete", "completed", "done"].includes(state)) return "succeeded";
  if (["error", "errored", "failure"].includes(state)) return "failed";
  if (["canceled", "stopped", "aborted"].includes(state)) return "cancelled";
  return "failed";
}

export function normalizeRun(input) {
  if (typeof input === "string") return { state: normalizeState(input) };
  if (!input || typeof input !== "object") return { state: "failed", error: "execution adapter returned no run" };
  return {
    ...input,
    state: normalizeState(input.state ?? input.status),
  };
}

function capabilityReport(value) {
  if (value == null) return {};
  const report = typeof value === "object" && !Array.isArray(value) && "capabilities" in value ? value.capabilities : value;
  return report && typeof report === "object" && !Array.isArray(report) ? report : {};
}

export function missingCapabilities(required, available) {
  const supported = new Set(Object.entries(capabilityReport(available)).filter(([, enabled]) => enabled === true).map(([name]) => name));
  return [...new Set(required ?? [])].filter((capability) => !KNOWN_CAPABILITIES.has(capability) || !supported.has(capability));
}

export function assertCapabilities(required, report) {
  const missing = missingCapabilities(required, report);
  if (missing.length) {
    throw new Error(`execution adapter cannot run recipe: missing capabilities: ${missing.join(", ")}`);
  }
  return report;
}

export class ExecutionAdapter {
  constructor({ name, capabilities: report, run, status, resume, cancel, result }) {
    if (typeof name !== "string" || !name) throw new Error("execution adapter name is required");
    if (typeof report !== "function") throw new Error("execution adapter capabilities() is required");
    for (const method of ["run", "status", "resume", "cancel", "result"]) {
      if (typeof arguments[0][method] !== "function") throw new Error(`execution adapter ${method}() is required`);
    }
    this.name = name;
    this.capabilitiesFn = report;
    this.runFn = run;
    this.statusFn = status;
    this.resumeFn = resume;
    this.cancelFn = cancel;
    this.resultFn = result;
  }

  capabilities() {
    return this.capabilitiesFn();
  }

  async run(recipe, context) {
    assertCapabilities(recipe?.required_capabilities ?? recipe?.requiredCapabilities ?? [], this.capabilities());
    return normalizeRun(await this.runFn(recipe, context));
  }

  async status(handle) {
    return normalizeRun(await this.statusFn(handle));
  }

  async resume(handle, input) {
    assertCapabilities(input?.required_capabilities ?? [], this.capabilities());
    return normalizeRun(await this.resumeFn(handle, input));
  }

  async cancel(handle) {
    return normalizeRun(await this.cancelFn(handle));
  }

  async result(handle) {
    return normalizeRun(await this.resultFn(handle));
  }
}
