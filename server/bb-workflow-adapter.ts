import { ExecutionAdapter, assertCapabilities } from "../lib/execution-adapter.mjs";
import { BB_NATIVE_CAPABILITIES } from "../lib/bb-workflow-capabilities.mjs";

export interface BbWorkflowTool {
  run(input: { recipe: unknown; context: unknown }): Promise<unknown>;
  status(handle: unknown): Promise<unknown>;
  resume(handle: unknown, input?: unknown): Promise<unknown>;
  cancel(handle: unknown): Promise<unknown>;
  result(handle: unknown): Promise<unknown>;
}

export interface BbWorkflowCapabilities {
  adapter: "bb-workflows";
  capabilities: Record<string, boolean>;
}

/**
 * BB's native workflow binding. The host injects the tool because the
 * Workflows plugin is optional; this module contains no import-time dependency
 * on its plugin ID or SDK and remains safe to load when Workflows is absent.
 */
function createBbWorkflowAdapterFromTool(tool: BbWorkflowTool): ExecutionAdapter {
  const report: BbWorkflowCapabilities = {
    adapter: "bb-workflows",
    capabilities: { ...BB_NATIVE_CAPABILITIES },
  };
  return new ExecutionAdapter({
    name: report.adapter,
    capabilities: () => report,
    run: (recipe, context) => {
      if (recipe.write_policy === "workspace") throw new Error("workspace-writing recipes require host file claims or sequential coordination");
      if (recipe.id === "scope-batch") throw new Error("scope-batch requires prepared file claims and a parent merge; native fan-out is disabled");
      assertCapabilities(recipe.required_capabilities ?? [], report);
      return tool.run({ recipe, context });
    },
    status: (handle) => tool.status(handle),
    resume: (handle, input) => tool.resume(handle, input),
    cancel: (handle) => tool.cancel(handle),
    result: (handle) => tool.result(handle),
  });
}

/** Capability detection is deliberately an injected query, not a plugin scan. */
export function createBbWorkflowAdapter(tool: BbWorkflowTool | null): ExecutionAdapter | null {
  if (!tool) return null;
  return createBbWorkflowAdapterFromTool(tool);
}
