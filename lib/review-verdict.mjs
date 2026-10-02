/**
 * Independent review verdicts. Pure input shaping + output validation for
 * `bb stelow review`; spawning, polling, and persistence live in server.ts.
 * The reviewer judges only what deterministic checks cannot (coherence,
 * scope fit, usefulness, request adherence) against the artifact contract —
 * it never re-derives counts the code already verified.
 */
import { MAX_REVIEW_CHARS, selectReviewExcerpt } from "./review-excerpt.mjs";

/** Input chars per artifact; the prompt names the truncation when it applies. */
export { MAX_REVIEW_CHARS };

/** Finding verdicts the host accepts. Anything else is human-review. */
export const REVIEW_VERDICTS = ["pass", "needs-revision", "human-review"];

/**
 * Build the reviewer prompt. criteria are binary checks derived from the
 * artifact contract; deterministicFailures (normally []) ride along so the
 * reviewer sees what the code already decided.
 *
 * `contract` is the resolved contract object when the caller has one. With it,
 * the excerpt is selected by the headings the contract names rather than by
 * offset, so a long introduction cannot push the required section past the cut
 * (see lib/review-excerpt.mjs). Without it the head slice is used, and the
 * prompt says which of the two the reviewer is looking at.
 *
 * Returns `{ prompt, excerpt }` — the excerpt report rides back to the caller so
 * the review row records what was sent, not merely that something was.
 */
export function buildReviewPrompt({ cardName, request, contractLabel, artifactContent, deterministicFailures = [], evidence = "verified", contract = null }) {
  const body = typeof artifactContent === "string" ? artifactContent : "";
  const excerpt = selectReviewExcerpt(body, contract);
  const failures = (Array.isArray(deterministicFailures) ? deterministicFailures : [])
    .filter((failure) => typeof failure === "string" && failure)
    .map((failure) => `- ${failure}`)
    .join("\n");
  return {
    prompt: reviewPromptText({ cardName, request, contractLabel, failures, evidence, excerpt }),
    excerpt,
  };
}

/**
 * The reviewer's standing orders, as one string.
 *
 * The long lines here are the prompt's own sentences rather than formatting —
 * a template literal broken mid-sentence to satisfy a line budget would be the
 * formatting target the repo's shape rules exist to prevent, not a fix for it.
 */
function reviewPromptText({ cardName, request, contractLabel, failures, evidence, excerpt }) {
  const hypothesis = evidence === "hypothesis-only"
    ? " (web research was unavailable; do not penalize missing external sources, do penalize claims stated as fact)"
    : "";
  return `You are an independent artifact reviewer. You did not write the artifact below and must not defend it. Judge it against its contract and the original request only.

Card: ${cardName}
Original request: ${request}
Contract: ${contractLabel}
Evidence status: ${evidence}${hypothesis}
Deterministic checks already run (do not re-derive these):
${failures || "- none failing"}
${truncationNote(excerpt)}Artifact:
${excerpt.text}

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
${QUOTE_RULES}`;
}

const QUOTE_RULES = "Rules: one criterion per finding; every finding carries a verbatim quote; "
  + "a finding without evidence is INSUFFICIENT — use human-review when the artifact gives you nothing to quote.";

/**
 * What the reviewer is told about its excerpt.
 *
 * The two truncations are named differently on purpose. "The contract's
 * sections" tells the reviewer it has the required material and is missing
 * context; "the first N chars" tells it the opposite, and a reviewer that
 * cannot tell which it holds will judge a document it never saw as though it
 * had. Both state that the rest must not be invented.
 */
function truncationNote(excerpt) {
  if (!excerpt.truncated) return "";
  const head = "Artifact truncated to " + MAX_REVIEW_CHARS + " of " + excerpt.originalChars
    + " chars for cost — judge coherence on what is shown, never invent the rest.\n";
  if (excerpt.selected === "contract") {
    const named = Array.isArray(excerpt.headings) && excerpt.headings.length > 0
      ? ` The sections sent are the ones this contract names: ${excerpt.headings.join(", ")}.`
      : "";
    return `${head}Sent: the contract's own sections, not the document's opening.${named}\n`;
  }
  return `${head}Sent: the document's first ${MAX_REVIEW_CHARS} chars; the contract's sections may lie past the cut.\n`;
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

/**
 * Read back the `Excerpt:` header each review record carries.
 *
 * The inverse of what `cli-review-verdict.ts` writes, and shaped for
 * `lib/review-truncation.mjs`, which does the counting. Returns one entry per
 * file that actually carries the line; a record written before the field
 * existed yields nothing rather than a zero, so a legacy review is uncounted
 * instead of being reported as a review that read the whole document.
 */
export function reviewExcerptRecords(reviewFiles) {
  const records = [];
  for (const file of Array.isArray(reviewFiles) ? reviewFiles : []) {
    const content = file && typeof file.content === "string" ? file.content : "";
    const match = content.match(/^Excerpt:\s*(\S+),\s*(\d+) of (\d+) chars,\s*(\S+)$/m);
    if (!match) continue;
    const [, selected, sentChars, originalChars, scope] = match;
    records.push({
      excerpt: {
        selected,
        sentChars: Number(sentChars),
        originalChars: Number(originalChars),
        truncated: scope === "truncated",
      },
    });
  }
  return records;
}
