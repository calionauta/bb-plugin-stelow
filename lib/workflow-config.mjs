import { legacyLabelForGates, normalizeReviewGates } from "./review-gates.mjs";

/**
 * Workflow config (run knobs + `review_mode`) parsed from a state.md blob.
 * Single source for every reader: the values live indented under a
 * `config:` block (see lib/state-template.mjs) with optional quoting, so
 * an anchored `^quality:` regex misses them entirely and a bare `(\S+)`
 * truncates multi-word review modes ("Product Spec + Interface + Tech
 * Review" degrades to "Product" — an invalid mode that matches no gate).
 *
 * Run knobs are canonical as `quality:` / `supervisor:` /
 * `exploration_count:` / `exploration_hybrid:`; the legacy `appetite:`
 * ladder string (Lean/Core/Complete) is accepted once and mapped to knobs
 * — rigor always resolves to the strongest level, breadth preserves the
 * old intent — then rewritten. Review gates are canonical as a
 * `review_gates: [spec, interface]` flow list; the legacy `review_mode:`
 * ladder string is kept for upstream readers and resolved through the
 * compat map (lib/review-gates).
 */

export const DEFAULT_QUALITY = "production";
export const DEFAULT_SUPERVISOR = "high";
export const DEFAULT_EXPLORATION_COUNT = 3;
export const DEFAULT_EXPLORATION_HYBRID = true;
/** @deprecated Alias only. New code uses the knob defaults above. */
export const DEFAULT_APPETITE = "Lean";
export const DEFAULT_REVIEW_MODE = "Auto";

/** Legacy appetite → knobs. Rigor always strongest; breadth keeps old intent. */
export const LEGACY_APPETITE_MAP = {
  Lean: { quality: "production", supervisor: "high", explorationCount: 2, explorationHybrid: true },
  Core: { quality: "production", supervisor: "high", explorationCount: 3, explorationHybrid: true },
  Complete: { quality: "production", supervisor: "high", explorationCount: 5, explorationHybrid: true },
};

const VALID_QUALITY = ["production", "experimental"];
const VALID_SUPERVISOR = ["low", "med", "high"];
export const VALID_RED_FIRST = ["strict", "advisory", "off"];
function clean(value, fallback) {
  const text = typeof value === "string" ? value.trim().replace(/^["']|["']$/g, "") : "";
  return text || fallback;
}

function cleanGates(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return normalizeReviewGates(clean(value, ""));
}

function cleanEnum(value, valid, fallback) {
  const text = clean(value, "");
  return valid.includes(text) ? text : fallback;
}

function cleanCount(value, fallback) {
  const n = Number.parseInt(clean(value, ""), 10);
  return n >= 1 && n <= 5 ? n : fallback;
}

function cleanHybrid(value, count, fallback) {
  const text = clean(value, "").toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  if (fallback !== null && fallback !== undefined) return fallback;
  return count >= 2;
}

/**
 * Resolve run knobs from an RPC-style input carrying explicit knobs and/or
 * a legacy `appetite`. Explicit knobs win; a legacy appetite maps once;
 * anything missing fails open to the strongest defaults. `explorationHybrid`
 * derives from the count (hybrid whenever count >= 2) unless explicitly set.
 */
export function resolveKnobInput(input) {
  const source = input && typeof input === "object" ? input : {};
  const legacy = (typeof source.appetite === "string" && LEGACY_APPETITE_MAP[source.appetite]) || null;
  const quality =
    (typeof source.quality === "string" && VALID_QUALITY.includes(source.quality) && source.quality) ||
    legacy?.quality ||
    DEFAULT_QUALITY;
  const supervisor =
    (typeof source.supervisor === "string" && VALID_SUPERVISOR.includes(source.supervisor) && source.supervisor) ||
    legacy?.supervisor ||
    DEFAULT_SUPERVISOR;
  const rawCount = Number(source.explorationCount);
  const explorationCount =
    Number.isInteger(rawCount) && rawCount >= 1 && rawCount <= 5
      ? rawCount
      : (legacy?.explorationCount ?? DEFAULT_EXPLORATION_COUNT);
  const explorationHybrid =
    typeof source.explorationHybrid === "boolean"
      ? source.explorationHybrid
      : explorationCount >= 2;
  // Red-first is pass-through, never defaulted: a valid explicit mode rides
  // along to the seed; anything else stays absent so the quality-derived
  // default applies downstream (absent means "derive me", not a mode).
  const redFirst =
    typeof source.redFirst === "string" && VALID_RED_FIRST.includes(source.redFirst)
      ? source.redFirst
      : undefined;
  return { quality, supervisor, explorationCount, explorationHybrid, redFirst };
}

/**
 * Parse run knobs/reviewMode from state.md text. Tolerates the indented
 * `config:` block and legacy top-level keys alike; missing state or fields
 * fail open to production/high/3+hybrid/Auto — unknown modes yield no skips
 * downstream, never invented ones. Strict mode returns nulls instead of
 * defaults, for callers that must distinguish "declared" from "assumed"
 * (a guard must never enforce against an assumed mode).
 *
 * `reviewGates` is the canonical set: an explicit `review_gates:` flow
 * list wins, otherwise it is derived from the legacy `review_mode:`
 * string through the compat map. Gate-aware callers prefer it;
 * `reviewMode` stays for legacy readers (novel sets have no ladder label
 * and read back as the compat label or the Auto default).
 *
 * `appetite` is returned as read (legacy passthrough) for old readers;
 * knob-aware callers prefer `quality`/`supervisor`/`explorationCount`.
 */
export function parseWorkflowConfig(blob, opts) {
  const strict = opts?.strict === true;
  const source = typeof blob === "string" ? blob : "";
  const legacyAppetite = clean(source.match(/^\s*appetite:\s*(.+)$/m)?.[1], null);
  const legacy = (legacyAppetite && LEGACY_APPETITE_MAP[legacyAppetite]) || null;
  const reviewMode = clean(source.match(/^\s*review_mode:\s*(.+)$/m)?.[1], strict ? null : DEFAULT_REVIEW_MODE);
  const declaredGates = cleanGates(source.match(/^\s*review_gates:\s*(.+)$/m)?.[1], null);
  const reviewGates =
    declaredGates ?? (reviewMode ? normalizeReviewGates(reviewMode) : null) ?? (strict ? null : []);
  const reviewModeLabel =
    reviewMode ?? (reviewGates ? legacyLabelForGates(reviewGates) : null) ?? (strict ? null : DEFAULT_REVIEW_MODE);
  const rawQuality = clean(source.match(/^\s*quality:\s*(.+)$/m)?.[1], null);
  const rawSupervisor = clean(source.match(/^\s*supervisor:\s*(.+)$/m)?.[1], null);
  const rawCount = source.match(/^\s*exploration_count:\s*(.+)$/m)?.[1] ?? null;
  const rawHybrid = source.match(/^\s*exploration_hybrid:\s*(.+)$/m)?.[1] ?? null;
  const quality =
    cleanEnum(rawQuality, VALID_QUALITY, null) ?? legacy?.quality ?? (strict ? null : DEFAULT_QUALITY);
  const supervisor =
    cleanEnum(rawSupervisor, VALID_SUPERVISOR, null) ?? legacy?.supervisor ?? (strict ? null : DEFAULT_SUPERVISOR);
  const explorationCount =
    cleanCount(rawCount, null) ?? legacy?.explorationCount ?? (strict ? null : DEFAULT_EXPLORATION_COUNT);
  let explorationHybrid;
  if (rawHybrid !== null) {
    explorationHybrid = cleanHybrid(rawHybrid, 2, true);
  } else if (legacy !== null) {
    explorationHybrid = legacy.explorationHybrid;
  } else if (strict) {
    explorationHybrid = null;
  } else {
    explorationHybrid = (explorationCount ?? DEFAULT_EXPLORATION_COUNT) >= 2;
  }
  return {
    quality,
    supervisor,
    explorationCount,
    explorationHybrid,
    appetite: legacyAppetite ?? (strict ? null : DEFAULT_APPETITE),
    reviewMode: reviewModeLabel,
    reviewGates,
  };
}
