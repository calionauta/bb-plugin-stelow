/**
 * Claim-registry key resolution: claims must be keyed by the checkout the
 * worker actually writes to, not by the project's declared source.
 * `project-default` workers run in the source itself (both paths agree);
 * `managed-worktree` workers run in a per-card worktree, where keying by
 * source would falsely serialize isolated cards (over-lock). Exploratory
 * cards resolve through the same rule via their own checkout. Pure so the
 * rule is tested without a BB host.
 */
export function resolveClaimKey({ checkoutPath, sourcePath }) {
  const pick = (value) => (typeof value === "string" && value.trim() ? value : null);
  return pick(checkoutPath) ?? pick(sourcePath);
}
