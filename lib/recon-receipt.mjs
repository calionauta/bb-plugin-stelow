export const RECON_RECEIPT_FILE = "context/recon-receipt.json";
export const RECON_RECEIPT_CONTRACT = "stelow-recon-v2";

export function reconReceiptStatus(content, stateDir = null) {
  if (typeof content !== "string" || !content.trim()) return { state: "missing", detail: `No ${RECON_RECEIPT_FILE} was found.` };
  try {
    const receipt = JSON.parse(content);
    if (!receipt || receipt.contract !== RECON_RECEIPT_CONTRACT || receipt.workspace?.git !== true || (stateDir && receipt.workflow?.stateDir !== stateDir)) {
      return { state: "invalid", detail: `${RECON_RECEIPT_FILE} is not a ${RECON_RECEIPT_CONTRACT} Git-workspace receipt.` };
    }
    const missing = Array.isArray(receipt.missing) ? receipt.missing.filter((name) => typeof name === "string") : [];
    return { state: "recorded", detail: missing.length ? `Optional tools unavailable: ${missing.join(", ")}.` : "All known optional tools were available." };
  } catch {
    return { state: "invalid", detail: `${RECON_RECEIPT_FILE} is not valid JSON.` };
  }
}
