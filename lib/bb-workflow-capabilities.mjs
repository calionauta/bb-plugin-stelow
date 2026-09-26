export const BB_NATIVE_CAPABILITIES = {
  fanout: true,
  pipeline: true,
  "structured-output": true,
  "durable-run": true,
  resume: true,
  cancel: true,
  status: true,
  "human-input": true,
  "per-call-model": false,
  "hidden-workers": true,
  "per-call-permission": false,
  "isolated-workspace": false,
  "file-claims": false,
};

// Capability gate for the scope-batch native pilot: fan-out is
// considered only when both entries report true. Both are false here,
// so every scope-batch evaluation fails closed to coordinator-sequential
// until the host proves them (see evaluateScopeBatchPilot).
export const SCOPE_BATCH_PILOT_CAPABILITY_GATE = [
  "file-claims",
  "isolated-workspace",
];

export function missingNativeCapabilities(required = []) {
  return required.filter((capability) => !(capability in BB_NATIVE_CAPABILITIES) || BB_NATIVE_CAPABILITIES[capability] !== true);
}
