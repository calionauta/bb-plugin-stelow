/**
 * Research / Explore artifact integrity. The deterministic half of the
 * artifact guarantee lives here as pure functions (pinned by unit tests);
 * server.ts only wires them to the filesystem + inbox.
 *
 * Contract (convention over configuration):
 * - every research round owns exactly one deterministic primary-file path.
 *   The worker creates it only when it has content to publish.
 * - every explore card owns exactly one file: explore-<stage>.md in its
 *   state dir, created only when its deliverable exists.
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
 * content or null; labelById maps a strategy id to its display label;
 * depthCheck(strategyId, content) returns failure detail lines or [] — null
 * keeps presence-only gating. Returns [{ n, label, reason?, detail? }] for
 * every invalid round, in round order.
 */
export function findInvalidRounds(history, readContent, indexBlob, labelById, depthCheck = null) {
  const invalid = [];
  for (const [index, entry] of history.entries()) {
    const n = index + 1;
    const label =
      (typeof labelById === "function" ? labelById(entry.id) : null) ?? entry.id;
    const content = readContent(entry.file);
    if (!isValidRoundContent(content, indexBlob)) {
      invalid.push({ n, label });
      continue;
    }
    if (typeof depthCheck === "function") {
      const failures = depthCheck(entry.id, content) ?? [];
      if (Array.isArray(failures) && failures.length > 0) {
        invalid.push({ n, label, reason: "needs-depth", detail: failures.slice(0, 3).join("; ") });
      }
    }
  }
  return invalid;
}

/**
 * Pure integrity scan over composite substeps.
 * substeps is [{ n, label, slug, path }]; readContent(path) returns the file
 * content or null; depthCheck(slug, content) returns failure detail lines
 * (from lib/artifact-validation) or [] — null skips depth validation, so
 * Phase 1 callers keep presence-only gating.
 * Returns [{ n, label, slug, reason, detail? }] for every invalid substep,
 * in input order. reason is missing | thin | mirrors-index | needs-depth.
 * Validity is the same isValidRoundContent predicate primaries use; depth
 * minima run only after presence passes, so one failure surfaces at a time.
 */
export function findInvalidSubsteps(substeps, readContent, indexBlob, depthCheck = null) {
  const invalid = [];
  for (const sub of Array.isArray(substeps) ? substeps : []) {
    if (!sub || typeof sub.path !== "string") continue;
    const content = typeof readContent === "function" ? readContent(sub.path) : null;
    if (content == null || (typeof content === "string" && content.trim().length === 0)) {
      invalid.push({ n: sub.n, label: sub.label, slug: sub.slug, reason: "missing" });
    } else if (researchRoundMirrorsIndex(content, indexBlob)) {
      invalid.push({ n: sub.n, label: sub.label, slug: sub.slug, reason: "mirrors-index" });
    } else if (!isValidRoundContent(content, indexBlob)) {
      invalid.push({ n: sub.n, label: sub.label, slug: sub.slug, reason: "thin" });
    } else if (typeof depthCheck === "function") {
      const failures = depthCheck(sub.slug, content) ?? [];
      if (Array.isArray(failures) && failures.length > 0) {
        invalid.push({ n: sub.n, label: sub.label, slug: sub.slug, reason: "needs-depth", detail: failures.slice(0, 3).join("; ") });
      }
    }
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
        .map((round) => {
          const name = round.slug ? `${round.label} — ${round.slug}` : round.label;
          const reason = round.reason === "missing"
            ? "missing — write it"
            : round.reason === "mirrors-index"
              ? "mirrors the index — write the playbook output"
              : round.reason === "thin"
                ? "thin — write the full playbook output"
                : round.reason === "needs-depth"
                  ? `needs depth — ${round.detail ?? "see the playbook completeness contract"}`
                  : "missing, thin, or mirrors the index — rewrite it";
          return `FAIL round ${round.n} (${name}): ${reason}, then run verify again.`;
        })
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
