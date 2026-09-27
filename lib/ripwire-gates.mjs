/**
 * Gate summaries for ripwire `--test-gate` and `--quality-delta` JSON.
 * Pure: parsed JSON in, compact summary out. Anything off-shape yields
 * null. Never throws. Counts stay exact from the numeric fields; only the
 * detail arrays are capped.
 */

export const MAX_GATE_ROWS = 50;

function num(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function testEntryToString(entry) {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  const parts = [entry.file, entry.symbol, entry.name].filter((p) => typeof p === "string" && p);
  return parts.join("::");
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const text = testEntryToString(entry);
    if (!text) continue;
    out.push(text);
    if (out.length >= MAX_GATE_ROWS) break;
  }
  return out;
}

/**
 * @param {unknown} json parsed ripwire `--test-gate` output
 * @returns {{ changed: number; impacted: number; tests: number; untested: number;
 *   testsToRun: string[]; untestedBlastRadius: unknown[]; obligations: boolean } | null}
 */
export function summarizeTestGate(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const testsToRun = stringList(json.tests_to_run);
  const rawBlast = Array.isArray(json.untested_blast_radius) ? json.untested_blast_radius : [];
  const untestedBlastRadius = rawBlast.slice(0, MAX_GATE_ROWS);
  return {
    changed: num(json.changed),
    impacted: num(json.impacted),
    tests: num(json.tests),
    untested: num(json.untested),
    testsToRun,
    untestedBlastRadius,
    obligations: testsToRun.length > 0 || untestedBlastRadius.length > 0,
  };
}

/**
 * @param {unknown} json parsed ripwire `--quality-delta` output
 * @returns {{ baseline: string | null; refs: string[]; regressions: number;
 *   minor: number; gating: number; blocked: boolean } | null}
 */
export function summarizeQualityDelta(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const regressions = num(json.regressions);
  const gating = num(json.gating);
  return {
    baseline: typeof json.baseline === "string" ? json.baseline : null,
    refs: ["regressions", "minor", "gating"],
    regressions,
    minor: num(json.minor),
    gating,
    blocked: regressions > 0 || gating > 0,
  };
}
