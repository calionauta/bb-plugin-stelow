/**
 * A stable code for a browser-side error.
 *
 * The action log deduplicates by `(kind, outcome, cause, card)`, so a UI error
 * recorded with the constant cause `ui.error` would collapse every distinct
 * browser failure in a ten-minute window into one row — the count would be
 * right and the answer would be gone. The cause therefore carries a short
 * fingerprint of the message, with the volatile parts masked first: an id, a
 * port, a timestamp or an index must not turn one recurring error into a
 * hundred causes.
 *
 * The mask is deliberately small and explained here because it changes what
 * groups together:
 *
 *   digits runs       → `#`   (ids, ports, counts, timestamps)
 *   quoted values     → `_`   (a name interpolated into a sentence)
 *   hex/uuid tokens   → `#`   (request ids)
 *   whitespace        → ` `
 *
 * The fingerprint is FNV-1a over the normalized message, rendered as eight hex
 * characters. It is not a security hash and must not be used as one; it exists
 * so two occurrences of the same failure share a cause and two different
 * failures do not.
 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** The text a fingerprint is computed over. Exported so a test can assert the
 * masking without reaching into the hash. */
export function normalizeClientError(message) {
  const text = String(message ?? "")
    .split("\n")[0]
    .trim()
    .toLowerCase();
  if (text.length === 0) return "unknown";
  return text
    // Prefixed host ids first: `card_cbnihg4c` is base36, so a digits-only rule
    // leaves the letters behind and one recurring error splits into one cause
    // per card. The prefix is kept — "card_#" still reads as a card — and the
    // suffix is what gets masked.
    .replace(/\b(card|thr|run|msg|evt|act|proj|env|ses|req|qn)_[a-z0-9]{4,}\b/g, "$1_#")
    // A uuid before the generic hex rule, because its dashes would split it.
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#")
    .replace(/\b[0-9a-f]{8,}\b/g, "#")
    .replace(/\d+/g, "#")
    .replace(/'[^']*'|"[^"]*"/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 160)
    || "unknown";
}

/** `ui.error.<surface>.<8 hex>`, always a valid action-log cause. */
export function clientErrorCause(surface, message) {
  const scope = String(surface ?? "app")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "app";
  return `ui.error.${scope}.${fingerprint(normalizeClientError(message))}`;
}

function fingerprint(text) {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
