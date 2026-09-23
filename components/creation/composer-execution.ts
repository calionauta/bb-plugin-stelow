import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

// Composer choice passthrough: provider, model, reasoning, permission,
// and any explicit service tier or input sources ride every creation
// submit (build, research, explore) into the spawn — through this one
// helper, never pasted per submit.
export function composerExecutionOf(request: NewThreadRequest) {
  return {
    providerId: request.providerId,
    model: request.model,
    reasoningLevel: request.reasoningLevel,
    permissionMode: request.permissionMode,
    ...(request.serviceTier ? { serviceTier: request.serviceTier } : {}),
    ...(request.executionInputSources ? { executionInputSources: request.executionInputSources } : {}),
  };
}
