export declare const PROBE_BASE_MS: number;
export declare const PROBE_MAX_MS: number;
export declare const PROBE_PASS_LIMIT: number;
export declare const PROBE_PASS_BUDGET_MS: number;
export declare function probeDelay(attempts: number): number;
export type ProbeBackoff = {
  due(cardId: string, at: number): boolean;
  failed(cardId: string, at: number): number;
  succeeded(cardId: string): void;
};
export declare function createProbeBackoff(): ProbeBackoff;
