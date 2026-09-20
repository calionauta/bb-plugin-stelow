/**
 * Inbox severity tiers. The queue used to be boolean (attention or not),
 * so a 3-day stall read identically to a fresh question. Tiers reorder —
 * never suppress: the badge still counts every open action item, and
 * every tier assignment carries reason chips instead of a bare number.
 *
 * L2 escalating: needs you now (old stall, repeated error, ancient item).
 * L1 action: needs you (question, fresh error, fresh pause).
 * L0 routine: review markers and FYI (completions).
 * Pure functions (no host dependency); thresholds live here alone so a
 * tuning pass touches one file, never a migration.
 */

export const SEVERITY_ROUTINE = 0;
export const SEVERITY_ACTION = 1;
export const SEVERITY_ESCALATING = 2;

// A pause older than this stops looking routine; any open action older
// than the outer window escalates regardless of kind.
export const SEVERITY_STALL_MS = 72 * 3600 * 1000;
export const SEVERITY_OLD_MS = 7 * 24 * 3600 * 1000;
export const SEVERITY_ERROR_REPETITIONS = 2;

export function stalledDays(ms) {
  return Math.max(0, Math.floor(ms / 86400000));
}

// Score one open event. Inputs are all observable at write or sweep time:
// kind, age in ms, the card's stall count, and unresolved error
// repetitions including the row being scored. Returns { severity, reasons }
// with short English chips the UI renders verbatim.
export function scoreEventSeverity({ kind, ageMs, stallCount, errorRepetitions }) {
  const age = typeof ageMs === "number" && ageMs > 0 ? ageMs : 0;
  if (kind === "completed") return { severity: SEVERITY_ROUTINE, reasons: ["review"] };
  if (kind === "paused" && age >= SEVERITY_STALL_MS) {
    return { severity: SEVERITY_ESCALATING, reasons: [`stalled ${stalledDays(age)}d`] };
  }
  if (kind === "error" && (errorRepetitions ?? 0) >= SEVERITY_ERROR_REPETITIONS) {
    return { severity: SEVERITY_ESCALATING, reasons: [`error ×${errorRepetitions}`] };
  }
  if (age >= SEVERITY_OLD_MS) {
    return { severity: SEVERITY_ESCALATING, reasons: [`waiting ${stalledDays(age)}d`] };
  }
  if (kind === "question") return { severity: SEVERITY_ACTION, reasons: ["needs decision"] };
  if (kind === "error") return { severity: SEVERITY_ACTION, reasons: ["needs recovery"] };
  if (kind === "paused") {
    const reasons = ["paused"];
    if ((stallCount ?? 0) > 0) reasons.push(`stall ×${stallCount}`);
    return { severity: SEVERITY_ACTION, reasons };
  }
  return { severity: SEVERITY_ACTION, reasons: [] };
}

// Stored reasons ride as a JSON array; unparseable or missing values read
// as no reasons — never a throw on the read path.
export function parseSeverityReasons(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string").slice(0, 6);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return parseSeverityReasons(JSON.parse(value));
  } catch {
    return [];
  }
}
