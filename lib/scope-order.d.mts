export declare const STATUS_RANK: Record<string, number>;
export declare function statusRank(status: unknown): number;
export declare function orderScopes<T>(scopes: unknown): {
  ordered: Array<T>;
  waitingOn: Map<string, string[]>;
};
