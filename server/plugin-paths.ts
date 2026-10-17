/**
 * Where the installed plugin keeps its files.
 *
 * Every vendored read (the helper script, the transitions contract, the
 * skills tree, the freshness stamp) hangs off one root, and resolving it is
 * layout-dependent: the source tree keeps skills/ beside server/, the bundled
 * tree keeps them one level above dist/. `resolvePluginRoot` owns that walk;
 * this module owns every path derived from it, so a layout change is one
 * edit instead of a scavenger hunt through the composition root.
 *
 * This file lives at server/ depth on purpose: the resolver only inspects
 * the calling module's own directory and its parent, so a module nested one
 * level deeper would resolve to the wrong root.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join as nodeJoin } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePluginRoot } from "../lib/plugin-paths.mjs";

/** Root of the installed plugin: skills/, data/, and the helper hang off it. */
export const pluginDir = resolvePluginRoot(
  dirname(fileURLToPath(import.meta.url)),
  existsSync,
);

/**
 * The vendored orchestrator helper, mirrored from upstream at release time.
 * Candidates are tried in order; an unreadable or empty one falls through so
 * a partial install still resolves a real path (and fails loudly at spawn,
 * naming the file) instead of silently resolving to nothing.
 */
export const HELPER_SCRIPT = (() => {
  const candidates = [
    nodeJoin(pluginDir, "data", "stelow"),
    nodeJoin(pluginDir, "..", "data", "stelow"),
  ];
  for (const candidate of candidates) {
    try {
      if (readFileSync(candidate, "utf8").length > 0) return candidate;
    } catch {
      /* try next */
    }
  }
  return candidates[0]!;
})();

export const PLUGIN_SKILLS_DIR = nodeJoin(pluginDir, "skills");

const PLUGIN_ORCHESTRATOR_REF = nodeJoin(
  PLUGIN_SKILLS_DIR,
  "stelow-workflow-orchestrator",
  "references",
);

// Transitions contract: always the vendored upstream copy (kept fresh by
// the skills sync). No root-mirror fallbacks — a missing vendored copy is
// a broken install and must fail closed, not silently use a stale mirror.
export const TRANSITIONS_REF = nodeJoin(PLUGIN_ORCHESTRATOR_REF, "transitions.md");

/**
 * Ground-truth freshness signal, written by scripts/postbuild.mjs. The panel
 * bundle and bb's plugin row are both sticky caches; the About tab renders
 * this so "did the reload take effect?" is checkable instead of vibes.
 * stelowVersion is the UPSTREAM release (synced data/stelow-package.json),
 * kept separate so the two versions can never be mistaken for each other.
 * Note the candidates assume the UNIFIED root (see resolvePluginRoot):
 * version.json only exists under dist/, package.json at the root.
 */
export const BUILD_INFO = (() => {
  const fallback = { version: "dev", builtAt: null as string | null };
  let version = fallback.version;
  let builtAt = fallback.builtAt;
  for (const candidate of [
    nodeJoin(pluginDir, "version.json"),
    nodeJoin(pluginDir, "dist", "version.json"),
    nodeJoin(pluginDir, "package.json"),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: unknown;
        builtAt?: unknown;
      };
      if (typeof parsed.version === "string") {
        version = parsed.version;
        builtAt = typeof parsed.builtAt === "string" ? parsed.builtAt : null;
        break;
      }
    } catch {
      /* try next */
    }
  }
  return { version, builtAt };
})();

/** The upstream version shipped with this plugin release. */
export function readPinnedStelowVersion(): string | null {
  for (const candidate of [
    nodeJoin(pluginDir, "data", "stelow-package.json"),
    nodeJoin(pluginDir, "..", "data", "stelow-package.json"),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: unknown;
      };
      if (typeof parsed.version === "string") return parsed.version;
    } catch {
      /* try next */
    }
  }
  return null;
}
