/**
 * Impact extraction for `sem impact --json`. Pure: parsed JSON in, compact
 * summary out. Anything off-shape yields null. Never throws.
 *
 * Expected shapes:
 *   Full: { entity, dependencies[], dependents[], impact: { entities[] },
 *           tests[] }
 *   Tests-only (--tests): { entity, tests[] }
 */

function num(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function str(value) {
  return typeof value === "string" ? value : "";
}

function linesOf(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((n) => typeof n === "number" && Number.isFinite(n));
}

function toRef(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = str(raw.entityId) || str(raw.id);
  if (!id) return null;
  return { id, name: str(raw.name), type: str(raw.type), file: str(raw.file), lines: linesOf(raw.lines) };
}

function refList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const ref = toRef(raw);
    if (ref) out.push(ref);
  }
  return out;
}

function transitiveList(impact) {
  if (!impact || typeof impact !== "object" || Array.isArray(impact)) return [];
  if (!Array.isArray(impact.entities)) return [];
  const out = [];
  for (const raw of impact.entities) {
    const ref = toRef(raw);
    if (!ref) continue;
    if (raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.depth === "number" && Number.isFinite(raw.depth)) {
      ref.depth = num(raw.depth);
    }
    out.push(ref);
  }
  return out;
}

/**
 * @param {unknown} json parsed `sem impact --json` output
 * @returns {{ entity: { id: string; name: string; type: string; file: string; lines: number[] };
 *   dependencies: Array<{ id: string; name: string; type: string; file: string; lines: number[] }>;
 *   dependents: Array<{ id: string; name: string; type: string; file: string; lines: number[] }>;
 *   transitive: Array<{ id: string; name: string; type: string; file: string; lines: number[]; depth?: number }>;
 *   tests: Array<{ id: string; name: string; type: string; file: string; lines: number[] }> } | null}
 */
export function summarizeSemImpact(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const entity = toRef(json.entity);
  if (!entity) return null;
  return {
    entity,
    dependencies: refList(json.dependencies),
    dependents: refList(json.dependents),
    transitive: transitiveList(json.impact),
    tests: refList(json.tests),
  };
}
