export declare function resolveLive(
  receipts: Array<Record<string, unknown>>,
): {
  live: Array<Record<string, unknown>>;
  superseded: Array<Record<string, unknown>>;
  conflicts: Array<{ a: string; b: string; scopeIds: string[] }>;
};
