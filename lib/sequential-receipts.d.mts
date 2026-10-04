export interface SequentialReceipt {
  taskId: unknown;
  path: string | null;
  present: boolean;
  skipped: boolean;
  reason: string | null;
}
export interface SequentialPlan {
  ordered: Array<{ taskId: unknown; output: unknown }>;
  skipped: string[];
  width: number;
  requiredOutputs: string[];
}
export function sequentialTaskPlan(
  recipe: { tasks?: readonly unknown[] },
  context?: Record<string, unknown>,
): SequentialPlan;
export function checklistLines(
  recipe: { tasks?: readonly unknown[] },
  context?: Record<string, unknown>,
): string[];
export function collectSequentialReceipts(input: {
  recipe: { id?: string; tasks?: readonly unknown[] };
  contents?: Record<string, unknown>;
  context?: Record<string, unknown>;
}): {
  ok: boolean;
  missing: string[];
  malformed: string[];
  issues: string[];
  width: number;
  requiredOutputs: string[];
  receipts: SequentialReceipt[];
};
