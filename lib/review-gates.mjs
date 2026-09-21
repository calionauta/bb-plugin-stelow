/**
 * Review gates as a multi-select set (RFC: review-gates-multiselect).
 *
 * The cumulative ladder ("Auto" … "… + Code Diff") could not express "only
 * interface alternatives" or "product spec + tech plan" — each rung implied
 * all previous gates. The canonical model is now a set of gate atoms:
 *
 *   spec       product gate + assumption asks
 *   interface  interface pick + int-gate
 *   scope      scope confirm
 *   tech       plan-gate + technical questions
 *   diff       diff gate (Code Diff stays separate from Tech Review)
 *
 * Empty set ≡ Auto: the LLM decides everything with receipts, never parks.
 * Unknown atoms/strings fail open (never invent a wait), matching the
 * stage-skips precedent. Ladder strings keep working through the compat
 * map in both directions; `stages.yaml` keeps ladder `modes` lists during
 * the transition, so contracts resolve ladder strings through the same
 * map until upstream speaks gate atoms natively.
 */

export const REVIEW_GATE_ATOMS = ["spec", "interface", "scope", "tech", "diff"];

/** Ladder order: each rung adds its atoms to all previous rungs. */
export const LEGACY_REVIEW_MODE_TO_GATES = {
  Auto: [],
  "Product Spec Gate": ["spec"],
  "Product Spec + Interface Gates": ["spec", "interface"],
  "Product Spec + Interface + Scopes": ["spec", "interface", "scope"],
  "Product Spec + Interface + Tech Review": ["spec", "interface", "scope", "tech"],
  "Product Spec + Interface + Tech Review + Code Diff": ["spec", "interface", "scope", "tech", "diff"],
};

export const REVIEW_MODES = Object.keys(LEGACY_REVIEW_MODE_TO_GATES);

const ATOM_ORDER = new Map(REVIEW_GATE_ATOMS.map((atom, index) => [atom, index]));

function sortedGates(gates) {
  return [...new Set(gates)].sort((a, b) => (ATOM_ORDER.get(a) ?? 99) - (ATOM_ORDER.get(b) ?? 99));
}

/** Parse the YAML flow-list subset used in state.md (`[spec, interface]`). */
function parseFlowList(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const values = [];
  let token = "";
  let quote = null;
  for (const char of trimmed.slice(1, -1)) {
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      if (token.trim()) values.push(token.trim());
      token = "";
    } else {
      token += char;
    }
  }
  if (quote) return null;
  if (token.trim()) values.push(token.trim());
  return values;
}

/**
 * Normalize any review-gate input to a canonical atom array (canonical
 * order, deduped). Accepts legacy ladder strings, single atoms, YAML flow
 * lists, and arrays mixing atoms with ladder strings. Unknown values fail
 * open to fewer gates — never an invented wait. Centralize here: no other
 * module may map ladder strings to sets.
 */
export function normalizeReviewGates(input) {
  if (Array.isArray(input)) {
    const gates = [];
    for (const entry of input) {
      if (typeof entry !== "string") continue;
      const text = entry.trim();
      if (ATOM_ORDER.has(text)) {
        gates.push(text);
        continue;
      }
      const mapped = LEGACY_REVIEW_MODE_TO_GATES[text];
      if (mapped) gates.push(...mapped);
    }
    return sortedGates(gates);
  }
  if (typeof input !== "string") return [];
  const text = input.trim();
  if (!text) return [];
  const mapped = LEGACY_REVIEW_MODE_TO_GATES[text];
  if (mapped) return [...mapped];
  if (ATOM_ORDER.has(text)) return [text];
  const listed = parseFlowList(text);
  if (listed) return sortedGates(listed.filter((entry) => ATOM_ORDER.has(entry)));
  return [];
}

/** Exact reverse map: the ladder rung for a set, or null for novel sets. */
export function legacyLabelForGates(gates) {
  const normalized = sortedGates(normalizeReviewGates(gates));
  for (const [label, mapped] of Object.entries(LEGACY_REVIEW_MODE_TO_GATES)) {
    if (mapped.length === normalized.length && mapped.every((atom, index) => atom === normalized[index])) return label;
  }
  return null;
}

/** Canonical state.md rendering: YAML flow list (`[spec, interface]`). */
export function formatReviewGates(gates) {
  return `[${sortedGates(normalizeReviewGates(gates)).join(", ")}]`;
}

/** Set predicates: which gates wait. Unselected gates never park. */
export function gateSelected(gates, atom) {
  return normalizeReviewGates(gates).includes(atom);
}

/** Human interface pick + assumption/critique asks wait on `interface`. */
export function interfaceRequiresHuman(gates) {
  return gateSelected(gates, "interface");
}

/** Scope IN/OUT confirmation waits on `scope`. */
export function scopeRequiresHuman(gates) {
  return gateSelected(gates, "scope");
}

/** The tech plan gate waits on `tech` (canonical matrix, not the ladder). */
export function planGateWaits(gates) {
  return gateSelected(gates, "tech");
}

/** The final code-diff gate waits on `diff`, separate from tech review. */
export function diffGateWaits(gates) {
  return gateSelected(gates, "diff");
}

/**
 * Skip reason naming the missing gate, not the rung. Legacy string callers
 * keep their mode-naming reasons; only set callers land here.
 */
export function skipReasonForGate(stage, gates) {
  const missing =
    stage === "selection" ? "interface"
    : stage === "plan-gate" ? "tech"
    : stage === "diff-gate" ? "diff"
    : stage === "scope" ? "scope"
    : "spec";
  const picked = formatReviewGates(gates);
  if (stage === "selection") return `Decided by the agent — interface review not selected ${picked}`;
  if (stage === "context") return `Skipped entirely — no review gates selected ${picked}`;
  return `Skipped — ${missing} review not selected ${picked}`;
}

/**
 * Gate stages eligible for an independent pre-review, mapped to the
 * artifact kind approveGate resolves — the same vocabulary, so the
 * pre-review can never judge a different document than the gate approves.
 * diff-gate reviews the working tree (no single file) and stays out: its
 * deterministic diff checks already run there. Unknown stages resolve
 * null — never a guess.
 */
export const PRE_REVIEW_GATE_ARTIFACT = {
  gate: "product-spec",
  "int-gate": "interfaces",
  "plan-gate": "tech-plan",
};

export function preReviewArtifactKind(stage) {
  if (typeof stage !== "string") return null;
  return Object.hasOwn(PRE_REVIEW_GATE_ARTIFACT, stage) ? PRE_REVIEW_GATE_ARTIFACT[stage] : null;
}
