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
export const NATIVE_SCOPE_BATCH_PILOT_ALLOWED: boolean;
export const SCOPE_BATCH_PILOT_MAX_CONCURRENCY: number;
export const SCOPE_BATCH_PILOT_TIMEOUT_MS: number;
export const SCOPE_BATCH_PILOT_REQUIRES: readonly string[];
export interface ScopeBatchPilotGates {
  pilot: boolean;
  capability: boolean;
  admission: boolean;
  disjointness: boolean;
  concurrency: boolean;
}
export interface ScopeBatchPilotDecision {
  mode: "native" | "coordinator-sequential";
  reason: string;
  code?: string;
  gates: ScopeBatchPilotGates;
  scopes?: string[];
  timeoutMs?: number;
  maxConcurrency?: number;
  missingCapabilities?: string[];
  unsatisfied?: string[];
  overlaps?: unknown;
}
export interface ScopeBatchPilotReceipt {
  scopeId?: unknown;
  id?: unknown;
  claimVerified?: unknown;
  filesTouched?: unknown;
  files?: unknown;
  artifacts?: unknown;
  artifactManifest?: unknown;
}
export function evaluateScopeBatchPilot(input?: {
  scopes?: readonly object[];
  satisfiedClaims?: unknown;
  satisfiedScopeIds?: unknown;
  nativeCapabilities?: Record<string, boolean>;
  nativePilotAllowed?: boolean;
  maxConcurrency?: number;
}): ScopeBatchPilotDecision;
export function verifyScopeBatchPilotReceipt(
  receipt: ScopeBatchPilotReceipt,
  expectedFiles?: readonly unknown[],
): { ok: boolean; code: string; scopeId?: string; reason?: string; outside?: string[] };
export function collectScopeBatchPilotReceipts(
  receipts: readonly ScopeBatchPilotReceipt[],
  partitions: Record<string, readonly unknown[]>,
): {
  ok: boolean;
  code: string;
  receiptsByScope?: Record<string, ScopeBatchPilotReceipt>;
  reason?: string;
  missing?: string[];
  extra?: string[];
  conflicts?: unknown;
};
