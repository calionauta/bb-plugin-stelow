export declare const AUDIT_RECEIPT_FILE: "audit.md";
export declare const AUDIT_RECEIPT_MIN_CHARS: number;
export declare const AUDIT_RECEIPT_NOTE: string;
export declare function auditReceiptReadiness(content: unknown, artifacts: unknown, expectedCheckout?: string | null, gitEvidence?: { gitRoot?: string | null; headSha?: string | null } | null, verification?: { command?: string } | null): { ready: true; error: null } | { ready: false; error: string };
