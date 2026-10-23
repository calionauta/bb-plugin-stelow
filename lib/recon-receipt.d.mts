export declare const RECON_RECEIPT_FILE: "context/recon-receipt.json";

export declare function reconReceiptStatus(content: unknown, stateDir?: string | null): {
  state: "recorded" | "missing" | "invalid";
  detail: string;
};
