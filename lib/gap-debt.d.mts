export declare function isAbsentValue(value: unknown): boolean;

export declare function parseGapDate(value: unknown): { date: string | null; error: string | null };

export declare function isDebtExpired(expires: unknown, nowMs: number): boolean;

export declare function expiredDebts(
  rows: unknown,
  nowMs: number,
): Array<{ description: string; expires: string; owner: string | null }>;

export declare function validateDebtExpiry(
  gap: { expires?: string | null },
  label: string,
): { code: string; expected: string; found: string; detail: string } | null;
