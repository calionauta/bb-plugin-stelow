/**
 * Workflow config (`appetite`, `review_mode`) parsed from a state.md blob.
 * Single source for every reader: the values live indented under a
 * `config:` block (see lib/state-template.mjs) with optional quoting, so
 * an anchored `^appetite:` regex misses them entirely and a bare `(\S+)`
 * truncates multi-word review modes ("Product Spec + Interface + Tech
 * Review" degrades to "Product" — an invalid mode that matches no gate).
 */

export const DEFAULT_APPETITE = "Lean";
export const DEFAULT_REVIEW_MODE = "Auto";

function clean(value, fallback) {
  const text = typeof value === "string" ? value.trim().replace(/^["']|["']$/g, "") : "";
  return text || fallback;
}

/**
 * Parse appetite/reviewMode from state.md text. Tolerates the indented
 * `config:` block and legacy top-level keys alike; missing state or fields
 * fail open to Lean/Auto — unknown modes yield no skips downstream, never
 * invented ones.
 */
export function parseWorkflowConfig(blob) {
  const source = typeof blob === "string" ? blob : "";
  return {
    appetite: clean(source.match(/^\s*appetite:\s*(.+)$/m)?.[1], DEFAULT_APPETITE),
    reviewMode: clean(source.match(/^\s*review_mode:\s*(.+)$/m)?.[1], DEFAULT_REVIEW_MODE),
  };
}
