/**
 * Independent review verdicts. Pure input shaping + output validation for
 * `bb stelow review`; spawning, polling, and persistence live in server.ts.
 * The reviewer judges only what deterministic checks cannot (coherence,
 * scope fit, usefulness, request adherence) against the artifact contract —
 * it never re-derives counts the code already verified.
 */

/** Input chars per artifact; the prompt names the truncation when it applies. */
export const MAX_REVIEW_CHARS = 12000;

/** Finding verdicts the host accepts. Anything else is human-review. */
export const REVIEW_VERDICTS = ["pass", "needs-revision", "human-review"];

/**
 * Build the reviewer prompt. criteria are binary checks derived from the
 * artifact contract; deterministicFailures (normally []) ride along so the
 * reviewer sees what the code already decided.
 */
export function buildReviewPrompt({ cardName, request, contractLabel, artifactContent, deterministicFailures = [], evidence = "verified" }) {
  const body = typeof artifactContent === "string" ? artifactContent : "";
  const truncated = body.length > MAX_REVIEW_CHARS;
  const artifact = truncated ? body.slice(0, MAX_REVIEW_CHARS) : body;
  const failures = (Array.isArray(deterministicFailures) ? deterministicFailures : [])
    .filter((failure) => typeof failure === "string" && failure)
    .map((failure) => `- ${failure}`)
    .join("\n");
  return `You are an independent artifact reviewer. You did not write the artifact below and must not defend it. Judge it against its contract and the original request only.

Card: ${cardName}
Original request: ${request}
Contract: ${contractLabel}
Evidence status: ${evidence}${evidence === "hypothesis-only" ? " (web research was unavailable; do not penalize missing external sources, do penalize claims stated as fact)" : ""}
Deterministic checks already run (do not re-derive these):
${failures || "- none failing"}
${truncated ? `Artifact truncated to ${MAX_REVIEW_CHARS} chars for cost; judge coherence on what is shown, never invent the rest.\n` : ""}Artifact:
${artifact}

Return ONLY one fenced JSON block, no other text:
\`\`\`json
{
  "verdict": "pass" | "needs-revision" | "human-review",
  "findings": [
    {
      "criterion": "one binary check, e.g. scope matches the request",
      "quote": "verbatim span from the artifact this finding rests on",
      "verdict": "PASS" | "FAIL",
      "repair": "objective fix, re-verifiable without judgment"
    }
  ]
}
\`\`\`
Rules: one criterion per finding; every finding carries a verbatim quote; a finding without evidence is INSUFFICIENT — use human-review when the artifact gives you nothing to quote.`;
}

/** Extract the first fenced json block, else null. */
export function extractJsonBlock(output) {
  const text = typeof output === "string" ? output : "";
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Validate a reviewer output against the artifact content. Quotes must be
 * character-exact substrings — a fabricated quote fails the finding, not
 * the artifact. Returns { status, findings[], dropped, raw } where dropped
 * counts findings removed for unverifiable quotes or bad shape.
 */
export function parseReviewOutput(output, artifactContent) {
  const body = typeof artifactContent === "string" ? artifactContent : "";
  const parsed = extractJsonBlock(output);
  if (!parsed || typeof parsed !== "object") {
    return { status: "human-review", findings: [], dropped: 0, raw: true };
  }
  if (!REVIEW_VERDICTS.includes(parsed.verdict)) {
    return { status: "human-review", findings: [], dropped: 0, raw: true };
  }
  const findings = [];
  let dropped = 0;
  for (const finding of Array.isArray(parsed.findings) ? parsed.findings : []) {
    if (
      !finding || typeof finding !== "object" ||
      typeof finding.criterion !== "string" || !finding.criterion.trim() ||
      typeof finding.quote !== "string" || !finding.quote.trim() ||
      (finding.verdict !== "PASS" && finding.verdict !== "FAIL") ||
      typeof finding.repair !== "string" || !finding.repair.trim() ||
      !body.includes(finding.quote)
    ) {
      dropped++;
      continue;
    }
    findings.push({
      criterion: finding.criterion.trim(),
      quote: finding.quote,
      verdict: finding.verdict,
      repair: finding.repair.trim(),
    });
  }
  return { status: parsed.verdict, findings, dropped, raw: false };
}

/** One-line summary for card comments and CLI output. */
export function reviewSummary(parsed) {
  const fails = parsed.findings.filter((finding) => finding.verdict === "FAIL").length;
  const extra = parsed.dropped > 0 ? ` (${parsed.dropped} finding(s) dropped for unverifiable quotes)` : "";
  return `Review verdict: ${parsed.status} — ${parsed.findings.length} finding(s), ${fails} failing${extra}.`;
}

/**
 * Policy gate: does a passing review cover this fingerprint? reviewFiles is
 * [{ name, content }] (newest first); only `Status: pass` files whose
 * `Fingerprint:` line matches count. Unknown shapes never satisfy.
 */
export function reviewCoversFingerprint(reviewFiles, fingerprint) {
  for (const file of Array.isArray(reviewFiles) ? reviewFiles : []) {
    const content = file && typeof file.content === "string" ? file.content : "";
    const status = (content.match(/^Status:\s*(\S+)/m) ?? [])[1] ?? null;
    const print = (content.match(/^Fingerprint:\s*(\S+)/m) ?? [])[1] ?? null;
    if (status === "pass" && print !== null && print === fingerprint) return true;
  }
  return false;
}
