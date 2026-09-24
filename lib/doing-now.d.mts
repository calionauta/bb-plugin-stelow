export function orderedDoingNow(executingScope: string | null | undefined, names: string[] | null | undefined): string[];

export declare function doingNowNames(
  scopes: Array<{ name?: string; status?: string; tasks?: Array<{ name?: string; status?: string }> | null } | null> | null | undefined,
  limit?: number,
): string[];
