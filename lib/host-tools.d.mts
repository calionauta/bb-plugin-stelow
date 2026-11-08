export declare const HOST_TOOL_IDS: readonly ["ast-grep", "cymbal", "ripwire", "sem", "xerj"];
export type HostToolId = (typeof HOST_TOOL_IDS)[number];
export interface HostToolMeta {
  id: HostToolId;
  name: string;
  repo: string;
  plain: string;
  tech: string;
  install: string;
}
export declare const HOST_TOOLS: readonly HostToolMeta[];
export interface HostToolStatus {
  id: HostToolId;
  present: boolean;
  version: string | null;
}
export declare function beginToolInstall(errors: Record<string, string>, id: HostToolId): Record<string, string>;
export declare function finishToolInstall(errors: Record<string, string>, id: HostToolId, error: unknown): Record<string, string>;
export declare function clearToolError(errors: Record<string, string>, id: HostToolId): Record<string, string>;
export declare function mergeToolStatuses(previous: HostToolStatus[] | null, next: unknown): HostToolStatus[] | null;
export declare function missingToolIds(tools: unknown): HostToolId[];
export declare function installAllTools(
  call: (id: HostToolId) => Promise<{ ok: boolean; log?: string } | null | undefined>,
  ids: unknown,
): Promise<{ ok: HostToolId[]; failed: Record<string, string> }>;
