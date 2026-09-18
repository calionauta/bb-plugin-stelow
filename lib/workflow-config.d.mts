export declare const DEFAULT_APPETITE: string;
export declare const DEFAULT_REVIEW_MODE: string;
export declare function parseWorkflowConfig(blob: unknown, opts?: { strict?: false }): { appetite: string; reviewMode: string; reviewGates: string[] };
export declare function parseWorkflowConfig(blob: unknown, opts: { strict: true }): { appetite: string | null; reviewMode: string | null; reviewGates: string[] | null };
