export type ReconcileOptions = {
  at: string;
  specSha256: string;
  taskMoves?: Array<{ fromScope: string; taskId: string; toScope: string }>;
};
export function reconcileScopeHistory(
  previous: Record<string, unknown>, generated: Record<string, unknown>, options: ReconcileOptions,
): { ok: true; changed: boolean; workflow: Record<string, unknown>; summary: Record<string, number> }
  | { ok: false; error: string };
