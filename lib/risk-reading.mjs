/**
 * One shared risk reading for gaps, scopes, and tasks.
 *
 * Risk is read off four axes — severity if it ships (`impact`), blast
 * radius (`callers`), reversibility, and verifiability (`check`) — never
 * labelled separately, so there is no fourth field to drift against the
 * other three. Levels derive from severity plus reversibility only;
 * caller counts and checks travel as cited reasons, because any numeric
 * blast threshold would be an invented number nobody calibrated.
 * Unknown severity reads unknown even with measurements: measurements
 * describe the blast, never the severity.
 */

const SEVERITY_LEVEL = { critical: "high", high: "high", medium: "moderate", low: "low" };

export function riskReading(input) {
  const source = input && typeof input === "object" ? input : {};
  const severity = String(source.impact ?? "").trim().toLowerCase();
  const reversible = typeof source.reversible === "string" ? source.reversible.trim().toLowerCase() : null;
  let level = SEVERITY_LEVEL[severity] ?? "unknown";
  if (reversible === "no" && level === "low") level = "moderate";
  else if (reversible === "no" && level === "moderate") level = "high";
  return { level, reasons: riskReasons(source, reversible) };
}

function riskReasons(source, reversible) {
  const reasons = [];
  if (typeof source.callers === "number") reasons.push(`${source.callers} caller(s)`);
  if (reversible === "no") reasons.push("irreversible");
  else if (reversible === "yes") reasons.push("reversible");
  if (typeof source.check === "string" && source.check.trim() !== "") reasons.push(`check: ${source.check.trim()}`);
  else if (typeof source.callers === "number") reasons.push("no proving check");
  return reasons;
}
