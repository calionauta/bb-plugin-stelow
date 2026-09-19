export declare const CLAIM_TERMINAL_STATUSES: string[];
export declare function isClaimTerminal(status: unknown): boolean;
export declare function errorNeedsAttention(status: unknown, lastError: unknown, activity: unknown): boolean;
