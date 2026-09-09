/**
 * Research / Explore artifact integrity. The deterministic half of the
 * artifact guarantee lives here as pure functions (pinned by unit tests);
 * server.ts only wires them to the filesystem + inbox.
 *
 * Contract (convention over configuration):
 * - every research round owns exactly one primary file, pre-created by the
 *   plugin at spawn (see ensureRoundFile in server.ts). The worker owns
 *   content, never structure.
 * - every explore card owns exactly one file: explore-<stage>.md in its
 *   state dir, pre-created by the plugin at spawn.
 * - a file is VALID when it is non-empty, meets a minimum real-content
 *   threshold, and (research only) does not mirror research-index.md.
 *   Anything else renders as missing and blocks completion — the worker
 *   prompt is a pointer to this contract, the code is the enforcer.
 *
 * Why code instead of prompt steps: prompt instructions ("Step 3b…") are
 * advisory — a distracted worker can skip them and the old code only noticed
 * AFTER marking the card Done. These predicates run on every sync poll, so a
 * missing/mirrored artifact can never pass silently as a done artifact.
 */

export const MIN_ROUND_CHARS = 200;
export const MIN_EXPLORE_CHARS = 200;

/**
 * True when a round file merely mirrors research-index.md: identical content
 * or starting with the index heading. Either shape means the playbook output
 * was never written to the round file.
 */
export function researchRoundMirrorsIndex(content, indexBlob) {
  return (
    indexBlob !== null &&
    content !== null &&
    (content === indexBlob || /^\s*#\s*Research index\b/m.test(content))
  );
}

/** True when a research round file holds real playbook output. */
export function isValidRoundContent(content, indexBlob, minChars = MIN_ROUND_CHARS) {
  const min = typeof minChars === "number" && minChars > 0 ? minChars : MIN_ROUND_CHARS;
  if (typeof content !== "string") return false;
  if (content.trim().length < min) return false;
  if (researchRoundMirrorsIndex(content, indexBlob)) return false;
  return true;
}

/** True when an explore artifact holds a real stage deliverable. */
export function isValidExploreContent(content, minChars = MIN_EXPLORE_CHARS) {
  const min = typeof minChars === "number" && minChars > 0 ? minChars : MIN_EXPLORE_CHARS;
  return typeof content === "string" && content.trim().length >= min;
}

/** Canonical explore artifact basename for a stage id. */
export function exploreArtifactFile(stageId) {
  return `explore-${stageId}.md`;
}

/**
 * Pure integrity scan over round history. readContent(path) returns the file
 * content or null; labelById maps a strategy id to its display label.
 * Returns [{ n, label }] for every invalid round, in round order.
 */
export function findInvalidRounds(history, readContent, indexBlob, labelById) {
  const invalid = [];
  for (const [index, entry] of history.entries()) {
    const n = index + 1;
    const label =
      (typeof labelById === "function" ? labelById(entry.id) : null) ?? entry.id;
    const content = readContent(entry.file);
    if (!isValidRoundContent(content, indexBlob)) invalid.push({ n, label });
  }
  return invalid;
}

/**
 * Worker self-check reports (`bb stelow verify`). Pure so the CLI stays a
 * thin wire to the same predicates the sync gate enforces — prompt, CLI,
 * and sync can never disagree on what PASS means.
 */
export function researchVerifyReport(cardId, roundCount, indexReviewable, invalidRounds) {
  const invalid = Array.isArray(invalidRounds) ? invalidRounds : [];
  const pass = indexReviewable === true && invalid.length === 0;
  return { card: cardId, kind: "research", indexReviewable, invalidRounds: invalid, pass, roundCount };
}

export function researchVerifyText(report) {
  if (report.pass === true) {
    return { exitCode: 0, stdout: `PASS: research ${report.card} — index reviewable, all ${report.roundCount} round file(s) valid.` };
  }
  const invalid = Array.isArray(report.invalidRounds) ? report.invalidRounds : [];
  if (invalid.length > 0) {
    return {
      exitCode: 1,
      stderr: invalid
        .map((round) => `FAIL round ${round.n} (${round.label}): missing, thin, or mirrors the index — rewrite it, then run verify again.`)
        .join("\n"),
    };
  }
  return { exitCode: 1, stderr: "FAIL: research-index.md not reviewable yet (no opportunities parsed) — finish the index, then run verify again." };
}

export function exploreVerifyReport(cardId, stage, ready) {
  return { card: cardId, kind: "explore", stage: stage ?? null, pass: ready === true };
}

export function exploreVerifyText(report) {
  if (report.pass === true) {
    return { exitCode: 0, stdout: `PASS: explore ${report.card} — ${exploreArtifactFile(report.stage ?? "")} holds the stage deliverable.` };
  }
  return { exitCode: 1, stderr: `FAIL: ${exploreArtifactFile(report.stage ?? "")} is missing or thin — write the stage deliverable, then run verify again.` };
}
