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

export function missingNativeCapabilities(required = []) {
  return required.filter((capability) => !(capability in BB_NATIVE_CAPABILITIES) || BB_NATIVE_CAPABILITIES[capability] !== true);
}
