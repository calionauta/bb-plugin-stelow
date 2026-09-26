import { EXECUTION_CAPABILITIES } from "./execution-adapter.mjs";
import { computeScopePartitions } from "./scope-partition.mjs";

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

/**
 * Pre-write enforcement for scope-batch: a scope may mutate a file only
 * when it holds a live claim for (checkout, file). Call this before any
 * workspace write or state.md mutation — never as a post-hoc audit.
 * `heldClaims` is the live claim set ({ scopeId, file, checkout } entries);
 * concurrent writes additionally require per-scope isolated workspaces or a
 * disjoint-plus-claimed proof. Throws CLAIM_REQUIRED on unclaimed writes.
 */
export function checkScopeWrite({ scopeId, file, checkout }, heldClaims = []) {
  const target = typeof file === "string" ? file.trim().replace(/\\/g, "/") : "";
  const root = typeof checkout === "string" ? checkout.trim() : "";
  const holder = typeof scopeId === "string" ? scopeId : "";
  const held = Array.isArray(heldClaims) ? heldClaims : [];
  const allowed = held.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const entryFile = typeof entry.file === "string" ? entry.file.trim().replace(/\\/g, "/") : "";
    const entryCheckout = typeof (entry.checkout ?? entry.workspacePath) === "string"
      ? String(entry.checkout ?? entry.workspacePath).trim()
      : "";
    const entryScope = typeof (entry.scopeId ?? entry.scope) === "string"
      ? String(entry.scopeId ?? entry.scope)
      : "";
    return entryFile === target && entryCheckout === root && entryScope === holder;
  });
  if (!allowed) {
    throw new Error(`CLAIM_REQUIRED scope=${holder || "?"} file=${target || "?"} checkout=${root || "?"}`);
  }
  return true;
}

export function isScopeWriteAllowed(input, heldClaims = []) {
  try {
    return checkScopeWrite(input, heldClaims) === true;
  } catch {
    return false;
  }
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

/**
 * Native scope-batch pilot boundary.
 *
 * The default route for scope-batch stays coordinator-sequential (see
 * resolveExecutionRoute above). Native fan-out is allowed ONLY for the
 * pilot class: independent disjoint scopes with satisfied file claims,
 * proven file-claims + isolated-workspace capabilities, bounded
 * concurrency, per-scope receipts, and parent post-merge verification.
 * Every other class falls back to coordinator-sequential with no
 * partial fan-out. One flag rolls everything back: pass
 * nativePilotAllowed=false (the recorded waiver value) and every batch
 * routes sequentially.
 */
export const NATIVE_SCOPE_BATCH_PILOT_ALLOWED = false;
export const SCOPE_BATCH_PILOT_MAX_CONCURRENCY = 4;
export const SCOPE_BATCH_PILOT_TIMEOUT_MS = 120_000;
export const SCOPE_BATCH_PILOT_REQUIRES = [
  "file-claims",
  "isolated-workspace",
];

function pilotScopeIds(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  return list
    .map((scope) => scope?.scopeId ?? scope?.id)
    .filter((id) => typeof id === "string" && id);
}

function pilotSatisfiedSet(satisfied) {
  if (satisfied instanceof Set) return satisfied;
  if (Array.isArray(satisfied)) {
    return new Set(
      satisfied
        .map((entry) => (typeof entry === "string" ? entry : entry?.scopeId ?? entry?.id))
        .filter((id) => typeof id === "string" && id),
    );
  }
  if (satisfied && typeof satisfied === "object") {
    return new Set(
      Object.entries(satisfied)
        .filter(([, enabled]) => enabled === true || enabled === "satisfied")
        .map(([id]) => id),
    );
  }
  return new Set();
}

function pilotSequential(reason, gates, details = {}) {
  return {
    mode: "coordinator-sequential",
    reason,
    gates,
    ...details,
  };
}

export function evaluateScopeBatchPilot({
  scopes = [],
  satisfiedClaims = [],
  satisfiedScopeIds = null,
  nativeCapabilities = {},
  nativePilotAllowed = NATIVE_SCOPE_BATCH_PILOT_ALLOWED,
  maxConcurrency = SCOPE_BATCH_PILOT_MAX_CONCURRENCY,
} = {}) {
  const gates = {
    pilot: false,
    capability: false,
    admission: false,
    disjointness: false,
    concurrency: false,
  };
  if (nativePilotAllowed !== true) {
    return pilotSequential(
      "scope-batch pilot is disabled; coordinator-sequential owns the batch",
      gates,
      { code: "PILOT_DISABLED" },
    );
  }
  gates.pilot = true;
  const missing = missingNativeCapabilities(SCOPE_BATCH_PILOT_REQUIRES, nativeCapabilities);
  if (missing.length > 0) {
    return pilotSequential(
      "file-claims and isolated-workspace capabilities are unproven; batch stays sequential",
      gates,
      { code: "PILOT_CAPABILITY_GATE", missingCapabilities: missing },
    );
  }
  gates.capability = true;
  const ids = pilotScopeIds(scopes);
  if (ids.length < 2) {
    return pilotSequential(
      "pilot needs at least two scopes to fan out; smaller batches stay sequential",
      gates,
      { code: "PILOT_SINGLE_SCOPE" },
    );
  }
  if (ids.length > maxConcurrency) {
    return pilotSequential(
      `batch of ${ids.length} exceeds the pilot concurrency bound of ${maxConcurrency}; no partial fan-out`,
      gates,
      { code: "PILOT_CONCURRENCY_BOUND" },
    );
  }
  gates.concurrency = true;
  const admission = computeScopePartitions(scopes);
  if (!admission.admitted) {
    return pilotSequential(
      "overlapping scopes never fan out; the whole batch stays sequential",
      gates,
      { code: "PARTITION_OVERLAP", overlaps: admission.overlaps },
    );
  }
  gates.disjointness = true;
  const satisfied = pilotSatisfiedSet(satisfiedScopeIds ?? satisfiedClaims);
  const unsatisfied = ids.filter((id) => !satisfied.has(id));
  const empty = ids.filter((id) => (admission.partitions[id] ?? []).length === 0);
  if (unsatisfied.length > 0 || empty.length > 0) {
    return pilotSequential(
      "every scope must present a satisfied file claim; missing claims reject the batch to sequential",
      gates,
      { code: "PILOT_ADMISSION_GATE", unsatisfied: [...unsatisfied, ...empty] },
    );
  }
  gates.admission = true;
  return {
    mode: "native",
    reason: "pilot batch: disjoint scopes with satisfied claims under bounded concurrency",
    code: "PILOT_ADMITTED",
    gates,
    scopes: [...ids],
    timeoutMs: SCOPE_BATCH_PILOT_TIMEOUT_MS,
    maxConcurrency,
  };
}

/**
 * Per-scope receipt gate: a child is merge-eligible only when it returns
 * claim verification, the files it touched, and an artifact manifest.
 * Receipts land per scope — never pooled across scopes.
 */
export function verifyScopeBatchPilotReceipt(receipt, expectedFiles = []) {
  const scopeId = receipt?.scopeId ?? receipt?.id;
  if (typeof scopeId !== "string" || !scopeId) {
    return { ok: false, code: "RECEIPT_SCOPE_MISSING", reason: "receipt names no scope" };
  }
  if (receipt?.claimVerified !== true) {
    return { ok: false, code: "RECEIPT_CLAIM_UNVERIFIED", scopeId, reason: `scope ${scopeId} has no claim verification` };
  }
  const touched = Array.isArray(receipt?.filesTouched)
    ? receipt.filesTouched
    : receipt?.files;
  if (!Array.isArray(touched) || touched.length === 0) {
    return { ok: false, code: "RECEIPT_FILES_MISSING", scopeId, reason: `scope ${scopeId} names no touched files` };
  }
  const expected = new Set(
    (Array.isArray(expectedFiles) ? expectedFiles : []).map((file) => String(file)),
  );
  const outside = expected.size > 0
    ? touched.map((file) => String(file)).filter((file) => !expected.has(file))
    : [];
  if (outside.length > 0) {
    return { ok: false, code: "RECEIPT_FILES_UNCLAIMED", scopeId, reason: `scope ${scopeId} touched unclaimed files`, outside };
  }
  const artifacts = receipt?.artifacts ?? receipt?.artifactManifest;
  const artifactCount = Array.isArray(artifacts)
    ? artifacts.length
    : artifacts && typeof artifacts === "object"
      ? Object.keys(artifacts).length
      : 0;
  if (artifactCount === 0) {
    return { ok: false, code: "RECEIPT_ARTIFACTS_MISSING", scopeId, reason: `scope ${scopeId} names no artifacts` };
  }
  return { ok: true, code: "RECEIPT_OK", scopeId };
}

/**
 * Pilot receipt collection: every scope needs exactly one valid receipt,
 * files-touched sets stay disjoint (write isolation), and artifacts land
 * per scope. Any failure refuses the merge — the coordinator retries
 * sequentially or escalates to inbox instead of merging partial work.
 */
export function collectScopeBatchPilotReceipts(receipts, partitions) {
  const expected = partitions && typeof partitions === "object" ? partitions : {};
  const scopeIds = Object.keys(expected);
  const list = Array.isArray(receipts) ? receipts : [];
  const byScope = new Map();
  for (const receipt of list) {
    const id = receipt?.scopeId ?? receipt?.id;
    if (typeof id !== "string" || !id) {
      return { ok: false, code: "RECEIPT_SCOPE_MISSING", reason: "a receipt names no scope" };
    }
    if (byScope.has(id)) {
      return { ok: false, code: "RECEIPT_DUPLICATE", scopeId: id, reason: `scope ${id} returned two receipts` };
    }
    byScope.set(id, receipt);
  }
  const missing = scopeIds.filter((id) => !byScope.has(id));
  if (missing.length > 0) {
    return { ok: false, code: "RECEIPT_MISSING", missing, reason: "every scope must return a receipt before merge" };
  }
  const extra = [...byScope.keys()].filter((id) => !scopeIds.includes(id));
  if (extra.length > 0) {
    return { ok: false, code: "RECEIPT_UNKNOWN_SCOPE", extra, reason: "receipts name scopes outside the batch" };
  }
  const receiptsByScope = {};
  const seenFiles = new Map();
  for (const id of scopeIds) {
    const checked = verifyScopeBatchPilotReceipt(byScope.get(id), expected[id] ?? []);
    if (!checked.ok) return { ok: false, ...checked, receiptsByScope: null };
    receiptsByScope[id] = byScope.get(id);
    const touched = Array.isArray(byScope.get(id)?.filesTouched)
      ? byScope.get(id).filesTouched
      : byScope.get(id).files;
    for (const file of touched.map((entry) => String(entry))) {
      if (seenFiles.has(file)) {
        return {
          ok: false,
          code: "RECEIPT_WRITE_OVERLAP",
          reason: `scopes ${seenFiles.get(file)} and ${id} both touched ${file}`,
          conflicts: [{ file, scopes: [seenFiles.get(file), id] }],
        };
      }
      seenFiles.set(file, id);
    }
  }
  return { ok: true, code: "RECEIPTS_COMPLETE", receiptsByScope };
}
