/**
 * Evidence gate for review gates. A gate stage (product, interface,
 * selection, tech plan) exists to review an artifact: a gateless question
 * ("approve the plan" with nothing to read) repeats the exact failure it
 * guards. The host refuses standard asks with no evidence attached —
 * methodology text stays advisory, this is the enforcement. An inline
 * `--preview` glance counts as evidence for short content; `--force` opts
 * out explicitly. Label-only options keep working everywhere else.
 */

export const GATE_EVIDENCE_STAGES = ["gate", "int-gate", "selection", "plan-gate"];

// Selection is a blind-choice machine without per-option evidence: every
// proposal must carry its own glance or file (upstream Pattern 2), so one
// evidenced option cannot launder blind siblings. Other gates review one
// shared document ("Approve" / "Request changes" are legitimately
// label-only), so a single evidence anywhere in the ask suffices there.
export const PER_OPTION_EVIDENCE_STAGES = ["selection"];

function hasEvidence(option) {
  if (option === null || typeof option !== "object" || Array.isArray(option)) return false;
  if (option.artifact !== null && option.artifact !== undefined) return true;
  return typeof option.preview === "string" && option.preview.trim().length > 0;
}

/**
 * Decide whether a worker ask may reach the human.
 * Returns { allowed, error }: refusals name the fix, never dead-end.
 */
export function gateEvidenceGate({ kind, stage, tag, forced, groups }) {
  if (forced) return { allowed: true, error: null };
  if (tag === "split") return { allowed: true, error: null };
  if (kind !== "build") return { allowed: true, error: null };
  if (!GATE_EVIDENCE_STAGES.includes(stage)) return { allowed: true, error: null };
  const options = (Array.isArray(groups) ? groups : []).flatMap((group) =>
    Array.isArray(group?.options) ? group.options : [],
  );
  if (options.length === 0) {
    return {
      allowed: false,
      error: `Refused: this build card is at \`${stage}\`, a review gate with nothing to review — attach the artifact under decision via --artifact <workspace-relative path> (or --preview for a short inline glance) on at least one option, or re-run with --force.`,
    };
  }
  if (PER_OPTION_EVIDENCE_STAGES.includes(stage)) {
    if (options.every(hasEvidence)) return { allowed: true, error: null };
    return {
      allowed: false,
      error: `Refused: this build card is at \`${stage}\`, where every option is a proposal to compare — attach --preview and --artifact on every option (labels alone force a blind choice), or re-run with --force.`,
    };
  }
  if (options.some(hasEvidence)) return { allowed: true, error: null };
  return {
    allowed: false,
    error: `Refused: this build card is at \`${stage}\`, a review gate with nothing to review — attach the artifact under decision via --artifact <workspace-relative path> (or --preview for a short inline glance) on at least one option, or re-run with --force.`,
  };
}
