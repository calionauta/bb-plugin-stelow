import { EXECUTION_CAPABILITIES } from "./execution-adapter.mjs";

const SEQUENTIAL_MODES = new Set(["sequential"]);
const NATIVE_WRITE_POLICIES = new Set(["artifact"]);
const KNOWN_CAPABILITIES = new Set(EXECUTION_CAPABILITIES);

function capabilityMap(value) {
  if (value == null) return {};
  const report = typeof value === "object" && !Array.isArray(value) && "capabilities" in value ? value.capabilities : value;
  return report && typeof report === "object" && !Array.isArray(report) ? report : {};
}

export function missingNativeCapabilities(required, available) {
  const supported = new Set(Object.entries(capabilityMap(available)).filter(([, enabled]) => enabled === true).map(([name]) => name));
  return [...new Set(required ?? [])].filter((capability) => !KNOWN_CAPABILITIES.has(capability) || !supported.has(capability));
}

function refusal(code, reason, redirect) {
  return { mode: "refused", code, reason, redirect };
}

function coordinator(reason, details = {}) {
  return { mode: "coordinator-sequential", reason, ...details };
}

export function resolveExecutionRoute({ recipe, requiredCapabilities = [], nativeCapabilities = {}, nativeAvailable = false }) {
  const fallback = recipe?.fallback;
  if (!fallback || typeof fallback !== "object" || typeof fallback.mode !== "string" || !Array.isArray(fallback.preserves)) {
    return refusal("fallback-missing", "The recipe has no valid fallback contract.", "Fix the recipe fallback before entering this stage.");
  }
  if (fallback.mode === "refuse") {
    return refusal("fallback-refused", "The recipe explicitly refuses fallback execution.", "Use a supported host or change the recipe fallback declaration.");
  }
  if (!SEQUENTIAL_MODES.has(fallback.mode)) {
    return refusal("fallback-unknown", `Unknown fallback mode: ${fallback.mode}.`, "Declare fallback.mode as sequential or refuse.");
  }
  if (recipe.write_policy === "workspace" || recipe.id === "scope-batch") {
    return coordinator("workspace-writing execution uses the existing card coordinator sequentially", { preserves: fallback.preserves });
  }
  if (!NATIVE_WRITE_POLICIES.has(recipe.write_policy)) {
    return coordinator("write policy is not safe for native execution", { preserves: fallback.preserves });
  }
  const missing = missingNativeCapabilities(requiredCapabilities, nativeCapabilities);
  if (missing.length > 0) {
    return coordinator("native capabilities are unavailable", { missingCapabilities: missing, preserves: fallback.preserves });
  }
  if (!nativeAvailable) {
    return coordinator("native Workflows are unavailable", { preserves: fallback.preserves });
  }
  return { mode: "native", missingCapabilities: [] };
}
