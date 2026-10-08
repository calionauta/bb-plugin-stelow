/**
 * Decision receipts. A receipt is the host-written record of one decided
 * selection: what won, what lost, which scopes it covers, and which versions
 * it authorizes. The worker proposes (through `bb stelow decide`); the host
 * mints. That division is the point — a receipt the worker could write itself
 * would be self-attestation, the failure this whole chain exists to prevent.
 *
 * Pure build/validate/serialize/parse here; file I/O lives in
 * `server/runtime/decision-store.ts`. Legacy files (unknown shapes) never
 * throw the loader: `parseReceipt` returns null and the caller skips them.
 */

export const DECISION_RECEIPTS_FILE = "decision-receipts.json";
export const DECISION_RECEIPT_SCHEMA_VERSION = 1;

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/;

/**
 * @param {object} input `{ selectedId, rejectedOptionIds?, scopeIds?, reason?, supersedes?, challengeId?, approvedBy?, approvedAt? }`
 * @param {{ id: string, shapeVersion?: string }} minted host-minted identity and versions
 * @returns {{ ok: true, receipt: object } | { ok: false, reason: string }}
 */
export function buildDecisionReceipt(input, minted) {
  const selectedId = typeof input?.selectedId === "string" ? input.selectedId.trim() : "";
  if (!selectedId) return { ok: false, reason: "a decision needs the winning option id (--selected)" };
  const id = typeof minted?.id === "string" ? minted.id : "";
  if (!ID_PATTERN.test(id)) return { ok: false, reason: "the host must mint a valid receipt id" };
  const rejected = asIdList(input?.rejectedOptionIds);
  if (rejected === null) return { ok: false, reason: "rejected options must be a list of ids" };
  if (rejected.includes(selectedId)) {
    return { ok: false, reason: "the winning option cannot also be rejected" };
  }
  const scopes = asIdList(input?.scopeIds);
  if (scopes === null) return { ok: false, reason: "scopes must be a list of ids" };
  const supersedes = asIdList(input?.supersedes);
  if (supersedes === null) return { ok: false, reason: "supersedes must be a list of receipt ids" };
  const approvedBy = typeof input?.approvedBy === "string" && input.approvedBy.trim()
    ? input.approvedBy.trim()
    : "operator";
  const receipt = {
    schemaVersion: DECISION_RECEIPT_SCHEMA_VERSION,
    id,
    kind: "selection",
    selectedId,
    rejectedOptionIds: rejected,
    scopeIds: scopes,
    authorizesVersions: {},
    supersedes,
    supersededBy: null,
    challengeId: typeof input?.challengeId === "string" && input.challengeId ? input.challengeId : null,
    reason: typeof input?.reason === "string" ? input.reason : null,
    approvedBy,
    approvedAt: typeof input?.approvedAt === "string" ? input.approvedAt : new Date().toISOString(),
  };
  if (typeof minted?.shapeVersion === "string" && minted.shapeVersion) {
    receipt.authorizesVersions.shape_version = minted.shapeVersion;
  }
  const issues = validateDecisionReceipt(receipt);
  if (issues.length > 0) return { ok: false, reason: issues.join("; ") };
  return { ok: true, receipt };
}

function asIdList(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim()).filter(Boolean);
  const ids = list.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean);
  if (ids.some((id) => !ID_PATTERN.test(id))) return null;
  return [...new Set(ids)];
}

/** @param {unknown} receipt @returns {string[]} empty when valid */
export function validateDecisionReceipt(receipt) {
  const issues = [];
  if (!receipt || typeof receipt !== "object") return ["receipt must be an object"];
  if (receipt.schemaVersion !== DECISION_RECEIPT_SCHEMA_VERSION) issues.push("unsupported schemaVersion");
  if (typeof receipt.id !== "string" || !ID_PATTERN.test(receipt.id)) issues.push("id must match [A-Za-z0-9_.-]{1,80}");
  if (typeof receipt.selectedId !== "string" || !receipt.selectedId) issues.push("selectedId must be non-empty");
  for (const field of ["rejectedOptionIds", "scopeIds", "supersedes"]) {
    if (!Array.isArray(receipt[field]) || receipt[field].some((id) => typeof id !== "string")) {
      issues.push(`${field} must be a string array`);
    }
  }
  if (typeof receipt.approvedBy !== "string" || !receipt.approvedBy) issues.push("approvedBy must be named");
  return issues;
}

/** Parse one stored receipt; null when the shape is unknown (skip, never throw). */
export function parseReceipt(value) {
  if (!value || typeof value !== "object") return null;
  const candidate = { ...value };
  if (typeof candidate.supersededBy !== "string") candidate.supersededBy = null;
  return validateDecisionReceipt(candidate).length === 0 ? candidate : null;
}

/** Parse the store file body; unknown shapes yield an empty set, never a throw. */
export function parseReceiptFile(text) {
  return parseReceiptStore(text).receipts;
}

/**
 * Parse the whole store: receipts plus the challenge registry, plus whether
 * the file was present-but-corrupt. Missing/corrupt reads never throw:
 * `corrupt` tells the caller to fail closed on writes (refuse to overwrite
 * evidence it cannot read) while reads stay best-effort.
 */
export function parseReceiptStore(text) {
  const empty = { receipts: [], challenges: [], corrupt: false };
  if (typeof text !== "string" || text.trim().length === 0) return empty;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...empty, corrupt: true };
  }
  if (!parsed || typeof parsed !== "object") return { ...empty, corrupt: true };
  const receipts = Array.isArray(parsed.receipts) ? parsed.receipts.map(parseReceipt).filter(Boolean) : [];
  const challenges = Array.isArray(parsed.challenges)
    ? parsed.challenges.map(parseChallenge).filter(Boolean)
    : [];
  return { receipts, challenges, corrupt: false };
}

/** A challenge opens against one live receipt; the gate honors names, not claims. */
export function buildChallenge(input, minted) {
  const receiptId = typeof input?.receiptId === "string" ? input.receiptId.trim() : "";
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  const id = typeof minted?.id === "string" ? minted.id : "";
  if (!ID_PATTERN.test(id)) return { ok: false, reason: "the host must mint a valid challenge id" };
  if (!receiptId) return { ok: false, reason: "a challenge names the receipt it contests (--against)" };
  if (!reason) return { ok: false, reason: "a challenge states why (--reason)" };
  return {
    ok: true,
    challenge: {
      id,
      receiptId,
      reason,
      openedBy: typeof input?.openedBy === "string" && input.openedBy.trim() ? input.openedBy.trim() : "operator",
      openedAt: typeof input?.openedAt === "string" ? input.openedAt : new Date().toISOString(),
    },
  };
}

/** @param {unknown} value @returns {object | null} null when the shape is unknown */
export function parseChallenge(value) {
  if (!value || typeof value !== "object") return null;
  const candidate = { ...value };
  if (typeof candidate.id !== "string" || !ID_PATTERN.test(candidate.id)) return null;
  if (typeof candidate.receiptId !== "string" || !candidate.receiptId) return null;
  if (typeof candidate.reason !== "string") return null;
  return candidate;
}

export function serializeReceiptFile(receipts, challenges = []) {
  return `${JSON.stringify({ version: 1, receipts, challenges }, null, 2)}\n`;
}
