export type ExecutionRouteMode = "native" | "coordinator-sequential" | "refused";
export type ExecutionRefusalCode = "fallback-missing" | "fallback-refused" | "fallback-unknown" | "unknown-recipe";
export interface ExecutionRoute {
  mode: ExecutionRouteMode;
  reason?: string;
  code?: ExecutionRefusalCode;
  redirect?: string;
  missingCapabilities?: string[];
  preserves?: string[];
}
export function missingNativeCapabilities(required: readonly string[] | undefined, available: Record<string, boolean> | undefined): string[];
export function resolveExecutionRoute(input: { recipe: unknown; requiredCapabilities?: string[]; nativeCapabilities?: Record<string, boolean>; nativeAvailable?: boolean }): ExecutionRoute;
export interface ScopeWriteInput {
  scopeId: unknown;
  file: unknown;
  checkout: unknown;
}
export interface HeldScopeClaim {
  scopeId?: unknown;
  scope?: unknown;
  file?: unknown;
  checkout?: unknown;
  workspacePath?: unknown;
}
export function checkScopeWrite(input: ScopeWriteInput, heldClaims?: readonly HeldScopeClaim[]): true;
export function isScopeWriteAllowed(input: ScopeWriteInput, heldClaims?: readonly HeldScopeClaim[]): boolean;
