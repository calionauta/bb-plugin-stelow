export declare const AUDIT_RECEIPT_FILE: "audit.md";
export declare const AUDIT_RECEIPT_MIN_CHARS: number;
export declare function auditReceiptReadiness(content: unknown, artifacts: unknown, expectedCheckout?: string | null): { ready: true; error: null } | { ready: false; error: string };
