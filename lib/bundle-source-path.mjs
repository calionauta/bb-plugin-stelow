import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Where a registered artifact actually is, when the card recorded it against
 * two different roots.
 *
 * `bb stelow export` reported 17 of card_48uuhus1's artifacts as unreadable.
 * They were on disk the whole time. The card's `state.md` records the same
 * artifact in two shapes — `.stelow/2026-10-01/sw-card_48uuhus1/context/...`
 * and `context/...` — and only the first resolved.
 *
 * The shape is not a mistake. `data/stelow:1640` records artifacts relative to
 * the directory `stelow advance` ran from, because that is the base the
 * manifest digests against. An agent that ran from inside the staging tree
 * wrote staging-relative paths; one that ran from the project root wrote
 * root-relative ones. Both are correct records of where the file was written,
 * and they disagree about what "relative" means.
 *
 * The state dir is the only place both shapes are true at once, so a source
 * that does not open at the project root is retried there. Nothing else
 * changes: the absolute-path and traversal refusals in
 * `resolveArtifactPath` still apply, and they apply to the retry too, so this
 * cannot become a way for a manifest to name a file outside the workspace.
 */

/**
 * Every root worth trying for one path from a manifest, in the order a reader
 * should try them.
 *
 * The project root comes first because that is the base a committed bundle has
 * to stay relative to: a path that resolves there is the one a reader opening
 * the repository will find. The state dir comes second and only because a card
 * that ran `stelow advance` from inside its own staging tree recorded
 * staging-relative paths — see the module comment.
 *
 * This decides what to *try*. Which one exists is the caller's question, and
 * it is the only one that can answer it.
 */
export function resolveBundleSource(
  sourcePath,
  { projectRoot, stateDir },
) {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) return [];
  return [
    projectRoot ? safeResolve(projectRoot, sourcePath) : null,
    stateDir ? safeResolve(stateDir, sourcePath) : null,
  ].filter((candidate, index, all) => candidate !== null && all.indexOf(candidate) === index);
}

/**
 * Resolve inside a root, or null when the path would escape it.
 *
 * The two refusals are load-bearing and copied from resolveArtifactPath on
 * purpose: a manifest is agent-produced input, and this must stay a fallback
 * for a wrong base rather than a way to reach any file on the host.
 */
function safeResolve(root, sourcePath) {
  if (isAbsolute(sourcePath)) return null;
  if (sourcePath.split(/[\\/]+/).some((segment) => segment === "..")) return null;
  try {
    const base = resolve(root);
    const full = resolve(base, sourcePath);
    const fromBase = relative(base, full);
    if (fromBase === ".." || fromBase.startsWith(`..${sep}`) || isAbsolute(fromBase)) return null;
    return full;
  } catch {
    return null;
  }
}
