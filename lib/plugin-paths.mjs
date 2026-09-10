/**
 * Plugin root resolution. The server entry runs from two layouts and every
 * runtime file read (skills/, data/, transitions.md) hangs off the root:
 *
 * - source layout (path installs, dev): `<root>/server.ts` — skills beside it
 * - bundled layout (git/npm managed installs): `<root>/dist/server.js` —
 *   skills one level up (dist/ ships only built bundles)
 *
 * Resolving from `import.meta.url` alone points at dist/ under managed
 * installs, so transitions.md (and the skills-sync target) 404s with
 * ENOENT exactly when creating cards. The marker is the transitions file
 * itself: the one runtime read that must never fail. Unknown layouts fall
 * back to the entry dir (previous behavior, same ENOENT as before).
 */
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const MARKER = ["skills", "stelow-workflow-orchestrator", "references", "transitions.md"];

export function resolvePluginRoot(hereDir, exists = existsSync) {
  if (typeof hereDir !== "string" || hereDir.length === 0) return hereDir;
  if (exists(join(hereDir, ...MARKER))) return hereDir;
  const parent = dirname(hereDir);
  if (parent !== hereDir && exists(join(parent, ...MARKER))) return parent;
  return hereDir;
}
