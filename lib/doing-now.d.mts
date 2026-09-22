export declare function doingNowNames(
  scopes: Array<{ name?: string; status?: string; tasks?: Array<{ name?: string; status?: string }> | null } | null> | null | undefined,
  limit?: number,
): string[];
