export const NORMALIZED_STATES: readonly ["queued", "running", "needs_input", "succeeded", "failed", "cancelled"];
export const EXECUTION_CAPABILITIES: readonly string[];
export interface NormalizedRun {
  state: "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";
  [key: string]: unknown;
}
export function normalizeRun(input: unknown): NormalizedRun;
export function missingCapabilities(required: readonly string[] | undefined, available: Record<string, boolean> | undefined): string[];
export function assertCapabilities(required: readonly string[] | undefined, report: unknown): unknown;
export class ExecutionAdapter {
  constructor(options: { name: string; capabilities: () => unknown; run: (...args: any[]) => unknown; status: (...args: any[]) => unknown; resume: (...args: any[]) => unknown; cancel: (...args: any[]) => unknown; result: (...args: any[]) => unknown });
  readonly name: string;
  capabilities(): unknown;
  run(recipe: unknown, context: unknown): Promise<NormalizedRun>;
  status(handle: unknown): Promise<NormalizedRun>;
  resume(handle: unknown, input?: unknown): Promise<NormalizedRun>;
  cancel(handle: unknown): Promise<NormalizedRun>;
  result(handle: unknown): Promise<NormalizedRun>;
}
