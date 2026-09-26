export declare function approveScopeMap(
  map: unknown,
  approval: { receiptId: string; approvedBy: string },
): { ok: true; map: Record<string, unknown> } | { ok: false; reason: string };
