export declare const AUDIT_RECEIPT_FILE: "audit.md";
export declare const AUDIT_RECEIPT_MIN_CHARS: number;
export declare function auditReceiptReadiness(content: unknown, artifacts: unknown, expectedCheckout?: string | null, gitEvidence?: { gitRoot?: string | null; headSha?: string | null } | null): { ready: true; error: null } | { ready: false; error: string };
