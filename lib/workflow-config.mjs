import { legacyLabelForGates, normalizeReviewGates } from "./review-gates.mjs";

/**
 * Workflow config (`appetite`, `review_mode`) parsed from a state.md blob.
 * Single source for every reader: the values live indented under a
 * `config:` block (see lib/state-template.mjs) with optional quoting, so
 * an anchored `^appetite:` regex misses them entirely and a bare `(\S+)`
 * truncates multi-word review modes ("Product Spec + Interface + Tech
 * Review" degrades to "Product" — an invalid mode that matches no gate).
 *
 * Review gates are canonical as a `review_gates: [spec, interface]` flow
 * list; the legacy `review_mode:` ladder string is kept for upstream
 * readers and resolved through the compat map (lib/review-gates).
 */

export const DEFAULT_APPETITE = "Lean";
export const DEFAULT_REVIEW_MODE = "Auto";

function clean(value, fallback) {
  const text = typeof value === "string" ? value.trim().replace(/^["']|["']$/g, "") : "";
  return text || fallback;
}

function cleanGates(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return normalizeReviewGates(clean(value, ""));
}

/**
 * Parse appetite/reviewMode from state.md text. Tolerates the indented
 * `config:` block and legacy top-level keys alike; missing state or fields
 * fail open to Lean/Auto — unknown modes yield no skips downstream, never
 * invented ones. Strict mode returns nulls instead of defaults, for callers
 * that must distinguish "declared" from "assumed" (a guard must never
 * enforce against an assumed mode).
 *
 * `reviewGates` is the canonical set: an explicit `review_gates:` flow
 * list wins, otherwise it is derived from the legacy `review_mode:`
 * string through the compat map. Gate-aware callers prefer it;
 * `reviewMode` stays for legacy readers (novel sets have no ladder label
 * and read back as the compat label or the Auto default).
 */
export function parseWorkflowConfig(blob, opts) {
  const strict = opts?.strict === true;
  const source = typeof blob === "string" ? blob : "";
  const reviewMode = clean(source.match(/^\s*review_mode:\s*(.+)$/m)?.[1], strict ? null : DEFAULT_REVIEW_MODE);
  const declaredGates = cleanGates(source.match(/^\s*review_gates:\s*(.+)$/m)?.[1], null);
  const reviewGates =
    declaredGates ?? (reviewMode ? normalizeReviewGates(reviewMode) : null) ?? (strict ? null : []);
  const reviewModeLabel =
    reviewMode ?? (reviewGates ? legacyLabelForGates(reviewGates) : null) ?? (strict ? null : DEFAULT_REVIEW_MODE);
  return {
    appetite: clean(source.match(/^\s*appetite:\s*(.+)$/m)?.[1], strict ? null : DEFAULT_APPETITE),
    reviewMode: reviewModeLabel,
    reviewGates,
  };
}
