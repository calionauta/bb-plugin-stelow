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
  ["execution context", /(?:^|\n)#{1,6}\s+execution context\b/im],
];

export function auditReceiptReadiness(content, artifacts, expectedCheckout = null, gitEvidence = null, verification = null) {
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
  if (expectedCheckout && !content.includes(expectedCheckout)) {
    return { ready: false, error: `${AUDIT_RECEIPT_FILE} must record this card's exact execution checkout (${expectedCheckout}) under Execution context. Completion is blocked until the audit evidence names the workspace it verified.` };
  }
  // The receipt is authored by the worker, but the Git identity is sampled by
  // the host at completion. This makes a stale or copied receipt fail closed:
  // it must name the exact root and HEAD that were actually audited.
  if (gitEvidence?.gitRoot && !content.includes(`Git root: ${gitEvidence.gitRoot}`)) {
    return { ready: false, error: `${AUDIT_RECEIPT_FILE} must record the verified Git root (${gitEvidence.gitRoot}) under Git evidence.` };
  }
  if (gitEvidence?.headSha && !content.includes(`HEAD: ${gitEvidence.headSha}`)) {
    return { ready: false, error: `${AUDIT_RECEIPT_FILE} must record the verified HEAD (${gitEvidence.headSha}) under Git evidence. Re-run the audit after any commit or checkout change.` };
  }
  const commandMentioned = verification?.command
    ? new RegExp(`(^|[^a-z0-9_-])${verification.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9_-])`, "i").test(content)
    : true;
  if (!commandMentioned) {
    return { ready: false, error: `${AUDIT_RECEIPT_FILE} must name the host-run test command (${verification.command}) under Tests. Re-run the audit after recording its actual result.` };
  }
  return { ready: true, error: null };
}
