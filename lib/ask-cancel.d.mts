export declare const TRANSIENT_CANCEL_REASONS: string[];
export declare function classifyAskCancel(outcome: string, reason: string | null, requestFailed?: boolean): "persist" | "passthrough";
export declare function interruptionWhy(reason: string | null, requestFailed: boolean, elapsedSecs: number): string;
