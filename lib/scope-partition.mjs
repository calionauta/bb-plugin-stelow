/**
 * Scope-batch partition admission: batch admits only when the transitive
 * file sets of all scopes are pairwise disjoint. Overlap refuses the whole
 * batch before any spawn — no partial dispatch.
 */

function normalizePath(raw) {
  if (typeof raw !== "string") return null;
  let text = raw.trim().replace(/\\/g, "/");
  if (!text) return null;
  while (text.startsWith("./")) text = text.slice(2);
  while (text.startsWith("/")) text = text.slice(1);
  const parts = [];
  for (const segment of text.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts.length === 0) return null;
  return parts.join("/");
}

function collectStrings(value, out) {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
  }
}

/**
 * Expand one scope's transitive footprint: declared targets plus imports,
 * reads, writes, and precomputed transitive closures from fixture state.md.
 */
export function expandScopeFiles(scope) {
  const raw = [];
  if (scope && typeof scope === "object") {
    collectStrings(scope.targetFiles, raw);
    collectStrings(scope.files, raw);
    collectStrings(scope.writes, raw);
    collectStrings(scope.reads, raw);
    collectStrings(scope.imports, raw);
    collectStrings(scope.transitiveFiles, raw);
    collectStrings(scope.transitive, raw);
  }
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const normalized = normalizePath(entry);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out.sort();
}

export function scopeClaimTag(batchId, scopeId) {
  if (batchId && scopeId) return `${batchId}::${scopeId}`;
  return scopeId ?? batchId ?? null;
}

/**
 * Admit a batch only when every scope pair is disjoint. Returns the
 * per-scope partitions plus, on overlap, PARTITION_OVERLAP naming each
 * offending file and the scopes that collide on it.
 */
export function computeScopePartitions(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const partitions = {};
  for (const scope of list) {
    const id = scope?.scopeId ?? scope?.id;
    if (typeof id !== "string" || !id) continue;
    partitions[id] = expandScopeFiles(scope);
  }
  const overlaps = [];
  const ids = Object.keys(partitions);
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const left = new Set(partitions[ids[i]]);
      for (const file of partitions[ids[j]]) {
        if (left.has(file)) {
          overlaps.push({ file, scopes: [ids[i], ids[j]] });
        }
      }
    }
  }
  if (overlaps.length > 0) {
    return { admitted: false, code: "PARTITION_OVERLAP", overlaps, partitions };
  }
  return { admitted: true, code: "PARTITIONS_DISJOINT", overlaps: [], partitions };
}
