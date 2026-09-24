export type HostToolId = "ast-grep" | "cymbal" | "ripwire" | "sem";
export interface HostToolStatus {
  id: HostToolId;
  present: boolean;
  version: string | null;
}
export declare function beginToolInstall(errors: Record<string, string>, id: HostToolId): Record<string, string>;
export declare function finishToolInstall(errors: Record<string, string>, id: HostToolId, error: unknown): Record<string, string>;
export declare function clearToolError(errors: Record<string, string>, id: HostToolId): Record<string, string>;
export declare function mergeToolStatuses(previous: HostToolStatus[] | null, next: unknown): HostToolStatus[] | null;
