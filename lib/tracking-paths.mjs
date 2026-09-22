/**
 * Uniform tracking-file layout (pure string builders, no I/O).
 *
 * Convention: every workflow-derived file lives under its state dir as
 * `<stateDir>/<area>/<basename>`, with fixed area names and fixed
 * basenames. `state.md` + `audit.md` live at the state-dir root (the
 * human mirror); machine artifacts live under areas:
 *
 *   plans/   spec-tech_<v>.md, spec-product_<v>.md (LLM-authored plans)
 *   scopes/  {scope-id}.json (scope contracts: acceptance_criteria, verify_commands)
 *   context/ recon-receipt.json (machine preflight receipt)
 *
 * The state-dir shape itself belongs to lib/workflow-state-identity.mjs
 * (`workflowStateRelativeDir`) — this module only appends areas below it,
 * so the "2-file pattern" (human mirror + machine tracking) and every
 * derived path share one construction rule instead of per-callsite joins.
 * Callers do I/O; failing to resolve here returns null and callers fail
 * open, never dead.
 */

function cleanDir(value) {
  return typeof value === "string" && value ? value.replace(/\/$/, "") : null;
}

/** `<stateRelDir>/plans` or null. */
export function plansRelDir(stateRelDir) {
  const base = cleanDir(stateRelDir);
  return base ? `${base}/plans` : null;
}

/** `<stateRelDir>/scopes` or null. */
export function scopesRelDir(stateRelDir) {
  const base = cleanDir(stateRelDir);
  return base ? `${base}/scopes` : null;
}

/** `<stateRelDir>/context/recon-receipt.json` or null. */
export function reconReceiptRelPath(stateRelDir) {
  const base = cleanDir(stateRelDir);
  return base ? `${base}/context/recon-receipt.json` : null;
}

/** Join a validated area file below the state dir. Refuses traversal. */
export function areaFileRelPath(stateRelDir, areaFile) {
  const base = cleanDir(stateRelDir);
  const file = typeof areaFile === "string" ? areaFile.trim().replace(/^\/+/, "") : "";
  if (!base || !file || file.includes("..")) return null;
  return `${base}/${file}`;
}

/** Whether a plans-dir filename is a spec-tech version (latest wins by sort). */
export function isSpecTechFile(name) {
  return typeof name === "string" && name.startsWith("spec-tech_") && name.endsWith(".md");
}
