// Run-bundle planning helpers (pure, no IO).
//
// `done` re-exports the bundle on every completion and `export --check`
// reports drift, so the committed docs/runs/<card>/ directory converges to
// the card's current artifacts instead of rotting after the first export.
// File reads/writes live in server.ts; this module only decides names and
// compares SHAs, which keeps the logic unit-testable.

/**
 * Assign stable bundle filenames to registered artifact sources.
 * Basenames stay stable (git history versions them); a repeated basename
 * gets a stage prefix, then a numeric suffix — never a silent overwrite.
 */
export function assignBundleNames(registered) {
  const used = new Set();
  const planned = [];
  for (const fields of Array.isArray(registered) ? registered : []) {
    const sourcePath = fields?.path;
    if (typeof sourcePath !== "string" || !sourcePath) continue;
    const stage = typeof fields?.stage === "string" && fields.stage ? fields.stage : "stage";
    const rawBase = sourcePath.replace(/\\/g, "/").split("/").pop() ?? "";
    const base = rawBase || "artifact.md";
    let name = base;
    if (used.has(name)) name = `${stage}-${base}`;
    let suffix = 2;
    while (used.has(name)) name = `${stage}-${base}-${suffix++}`;
    used.add(name);
    planned.push({ name, stage: fields?.stage ?? null, sourcePath });
  }
  return planned;
}

/**
 * Parse the `| File | Stage | SHA-8 | Source |` table out of a bundle
 * manifest.md. Returns [] for foreign content — a hand-edited or missing
 * manifest reads as "nothing bundled", never as a parse error.
 */
export function parseBundleManifest(content) {
  const entries = [];
  for (const line of String(content ?? "").split("\n")) {
    const match = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*`([0-9a-f]{8}|\?{8})`\s*\|\s*(.+?)\s*\|$/);
    if (!match) continue;
    const [, name, stage, sha8, sourcePath] = match;
    if (name === "File" || !sourcePath) continue;
    entries.push({ name, stage: stage === "?" ? null : stage, sha8, sourcePath });
  }
  return entries;
}

/**
 * Compare bundled SHAs against current source SHAs.
 * shaBySource maps sourcePath -> sha8 hex (or null when unreadable).
 * Unknown (`????????`) bundled SHAs always count as stale.
 */
export function staleBundleEntries(manifestEntries, shaBySource) {
  const lookup = shaBySource instanceof Map
    ? (key) => shaBySource.get(key)
    : (key) => shaBySource?.[key];
  const stale = [];
  for (const entry of Array.isArray(manifestEntries) ? manifestEntries : []) {
    if (!entry || typeof entry.sourcePath !== "string" || !entry.sourcePath) continue;
    const current = lookup(entry.sourcePath);
    if (typeof current !== "string" || !current) {
      stale.push({ ...entry, reason: "missing" });
      continue;
    }
    if (current !== entry.sha8) stale.push({ ...entry, reason: "changed" });
  }
  return stale;
}

/**
 * Registered sources with no row in the manifest — artifacts produced
 * after the last export. Together with staleBundleEntries this is the
 * full drift picture `export --check` reports.
 */
export function unbundledSources(registered, manifestEntries) {
  const bundled = new Set(
    (Array.isArray(manifestEntries) ? manifestEntries : [])
      .map((entry) => entry?.sourcePath)
      .filter((path) => typeof path === "string" && path),
  );
  return (Array.isArray(registered) ? registered : [])
    .map((fields) => fields?.path)
    .filter((path) => typeof path === "string" && path && !bundled.has(path));
}
