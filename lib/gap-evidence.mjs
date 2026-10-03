/**
 * Measured evidence behind a gap verdict (pure, no I/O).
 *
 * An `evidence:` block cites host measurements (symbols, files, caller
 * counts, covering tests, reversibility, proving check). Absent reads as
 * unmeasured, never as a failure; malformed fails, so the format is taught
 * rather than guessed. Split out of gap-registry.mjs: normalising
 * measurements is a different capability from parsing the registry, with a
 * different reason to change.
 */
import { isAbsentValue } from "./gap-debt.mjs";

const REVERSIBLES = new Set(["yes", "no", "unknown"]);

export function stripQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** A string or flow-style `[a, b]` list as an array of names. Anything else
 * reads empty — the caller decides whether emptiness is an error. */
function evidenceNames(value) {
  if (isAbsentValue(value)) return [];
  const text = String(value).trim();
  if (text === "" || text === "[]") return [];
  const inner = text.startsWith("[") ? text.replace(/^\[/, "").replace(/\]$/, "") : text;
  return inner.split(",").map((part) => stripQuotes(part.trim())).filter((name) => name !== "" && !isAbsentValue(name));
}

function evidenceCallers(value) {
  if (isAbsentValue(value)) return { callers: null, error: null };
  if (/^\d+$/.test(String(value).trim())) return { callers: parseInt(String(value).trim(), 10), error: null };
  return { callers: null, error: `callers must be a non-negative integer — found ${value}` };
}

/**
 * Normalise a raw `evidence:` mapping. Absent keys read null/empty (the gap
 * is unmeasured, not malformed); wrong types fail, so the format is taught
 * rather than guessed. Unknown keys are ignored for forward compatibility.
 */
export function normalizeGapEvidence(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!source) return { evidence: null, error: "evidence must be a mapping of symbols/files/callers/tests/reversible/check, not a scalar" };
  const { callers, error: callersError } = evidenceCallers(source.callers);
  if (callersError) return { evidence: null, error: callersError };
  const reversibleRaw = isAbsentValue(source.reversible) ? null : String(source.reversible).trim().toLowerCase();
  if (reversibleRaw && !REVERSIBLES.has(reversibleRaw)) {
    return { evidence: null, error: `reversible must be yes, no, or unknown — found ${source.reversible}` };
  }
  const checkRaw = isAbsentValue(source.check) ? null : String(source.check).trim();
  return {
    evidence: {
      symbols: evidenceNames(source.symbols),
      files: evidenceNames(source.files),
      callers,
      tests: evidenceNames(source.tests),
      reversible: reversibleRaw,
      check: checkRaw,
    },
    error: null,
  };
}

/** A gap cites measurements only when at least one evidence field is set:
 * an empty block is present-but-vacuous, which counts as unmeasured. */
export function hasGapEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  return (Array.isArray(evidence.symbols) && evidence.symbols.length > 0)
    || (Array.isArray(evidence.files) && evidence.files.length > 0)
    || (typeof evidence.callers === "number")
    || (Array.isArray(evidence.tests) && evidence.tests.length > 0)
    || (typeof evidence.reversible === "string")
    || (typeof evidence.check === "string");
}

/** The evidence dimension: fail-open when absent (registries written before
 * it existed, and workers on hosts without measurement tools, never fail
 * for not citing it) but fail-closed when present, so the format is taught
 * rather than guessed. */
export function validateGapEvidence(gap, label) {
  if (!gap.evidenceError) return null;
  return {
    code: "gap-evidence-shape",
    expected: `${label}: evidence mapping with symbols/files/callers/tests/reversible/check`,
    found: `${label}: ${gap.evidenceError}`,
    detail: `${label} cites evidence that does not parse — ${gap.evidenceError}`,
  };
}
