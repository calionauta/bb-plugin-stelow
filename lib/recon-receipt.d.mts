export declare const RECON_RECEIPT_FILE: "context/recon-receipt.json";
export declare const RECON_RECEIPT_CONTRACT: "stelow-recon-v2";

export declare function reconReceiptStatus(content: unknown, stateDir?: string | null): {
  state: "recorded" | "missing" | "invalid";
  detail: string;
};

/**
 * Whether the recon receipt deserves a line on an active card: missing,
 * unreadable, or recorded-but-degraded (optional tools unavailable, so
 * analysis fell back to portable). All-available receipts stay silent.
 */
export declare function isReconActionable(
  recon: { state?: string; detail?: string } | null | undefined,
): boolean;
