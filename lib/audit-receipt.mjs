/**
 * The audit stage is a review, not merely a terminal label. A Build card
 * therefore carries a durable, human-readable receipt before it can become
 * Done. The host validates its structure; it does not pretend to infer a
 * product's acceptance criteria or fabricate test results.
 */
export const AUDIT_RECEIPT_FILE = "audit.md";
export const AUDIT_RECEIPT_MIN_CHARS = 350;

const REQUIRED_SECTIONS = [
  ["acceptance criteria", /(?:^|\n)#{1,6}\s+acceptance criteria\b/im],
  ["verification", /(?:^|\n)#{1,6}\s+verification\b/im],
  ["tests", /(?:^|\n)#{1,6}\s+(?:test|tests|test evidence)\b/im],
  ["Git evidence", /(?:^|\n)#{1,6}\s+(?:git|version control)\b/im],
];

export function auditReceiptReadiness(content, artifacts) {
  if (typeof content !== "string" || content.trim().length < AUDIT_RECEIPT_MIN_CHARS) {
    return {
      ready: false,
      error: `Write a substantive ${AUDIT_RECEIPT_FILE} (at least ${AUDIT_RECEIPT_MIN_CHARS} characters) before marking this Build card Done.`,
    };
  }
  const missing = REQUIRED_SECTIONS.filter(([, pattern]) => !pattern.test(content)).map(([name]) => name);
  if (missing.length > 0) {
    return {
      ready: false,
      error: `${AUDIT_RECEIPT_FILE} is missing: ${missing.join(", ")}. Record the criteria, verification evidence, test commands/results, and Git state.`,
    };
  }
  const registered = Array.isArray(artifacts) && artifacts.some((entry) => entry
    && typeof entry === "object"
    && entry.stage === "audit"
    && typeof entry.path === "string"
    && entry.path.replace(/\\/g, "/").endsWith(`/${AUDIT_RECEIPT_FILE}`));
  if (!registered) {
    return {
      ready: false,
      error: `Register ${AUDIT_RECEIPT_FILE} under stage: audit in state.md so it appears in the card's artifact trail.`,
    };
  }
  return { ready: true, error: null };
}
