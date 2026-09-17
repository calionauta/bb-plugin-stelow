export declare const RECON_RECEIPT_FILE: "context/recon-receipt.json";
export declare const RECON_RECEIPT_CONTRACT: "stelow-recon-v1";

export declare function reconReceiptStatus(content: unknown): {
  state: "recorded" | "missing" | "invalid";
  detail: string;
};
