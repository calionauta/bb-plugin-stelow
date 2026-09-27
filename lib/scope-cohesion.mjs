/**
 * Scope-collision detection over [{ id, symbols[] }]. Pure: normalized
 * symbol sets in, unordered colliding pairs out. Returns [] when nothing
 * collides, null on off-shape input. Never throws.
 */

function normalizeScope(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (typeof entry.id !== "string") return null;
  const id = entry.id.trim();
  if (!id || !Array.isArray(entry.symbols)) return null;
  const seen = new Set();
  for (const symbol of entry.symbols) {
    if (typeof symbol !== "string") continue;
    const clean = symbol.trim();
    if (clean) seen.add(clean);
  }
  return { id, symbols: seen };
}

/**
 * @param {unknown} scopes [{ id: string, symbols: string[] }]
 * @returns {Array<{ a: string; b: string; shared: string[] }> | null}
 */
export function findScopeCollisions(scopes) {
  if (!Array.isArray(scopes)) return null;
  const normalized = [];
  for (const entry of scopes) {
    const scope = normalizeScope(entry);
    if (!scope) return null;
    normalized.push(scope);
  }
  const out = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const first = normalized[i];
      const second = normalized[j];
      if (first.id === second.id) continue;
      const shared = [...first.symbols].filter((s) => second.symbols.has(s)).sort();
      if (shared.length === 0) continue;
      const pair = [first.id, second.id].sort();
      out.push({ a: pair[0], b: pair[1], shared });
    }
  }
  out.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
  return out;
}
