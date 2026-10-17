/**
 * Path jail: every filesystem path that crosses an RPC or agent boundary
 * resolves inside an allowed root or it resolves to nothing.
 *
 * `resolve` alone is not a jail — `resolve(root, "../../etc/passwd")`
 * happily returns `/etc/passwd`. The jail is `resolve` PLUS a `startsWith`
 * check against the canonical root, so `..` segments, absolute outsiders,
 * and separator tricks all land on `null` instead of a file.
 *
 * Managed worktrees are the one exit: a card's checkout may legitimately
 * live outside its project root (exploratory cards, recovery attachments).
 * Those roots travel in an explicit allowlist — registered project sources,
 * never caller input — and a path under one of them is allowed exactly as a
 * path under the workspace root is.
 */
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function within(root, absolute) {
  const fromRoot = relative(root, absolute);
  if (fromRoot === "" || fromRoot === ".") return true;
  return !fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot);
}

/**
 * Resolve `candidate` against `rootPath`, jailed. Returns the absolute path
 * when it stays inside `rootPath` (or inside one of `opts.allowlist`
 * roots), `null` otherwise. Non-string, empty, and NUL-carrying inputs are
 * always `null` — there is no path there to resolve.
 */
export function resolveWithinRoot(rootPath, candidate, opts = {}) {
  if (typeof rootPath !== "string" || !rootPath) return null;
  if (typeof candidate !== "string" || !candidate.trim() || candidate.includes("\0")) return null;
  let root, absolute;
  try {
    root = resolve(rootPath);
    absolute = resolve(root, candidate);
  } catch {
    return null;
  }
  if (within(root, absolute)) return linkedWithin(root, absolute);
  const allowlist = Array.isArray(opts.allowlist) ? opts.allowlist : [];
  for (const entry of allowlist) {
    if (typeof entry !== "string" || !entry) continue;
    try {
      const base = resolve(entry);
      if (within(base, absolute)) return linkedWithin(base, absolute);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * The symlink re-check: `resolve` is lexical, so a link planted inside the
 * root can name bytes outside it and the string check above passes. When
 * the resolved path exists, its real location must jail too — otherwise a
 * workspace symlink is a read of the host through this door. A link that
 * cannot be resolved (dangling, racing) keeps the lexical verdict and fails
 * downstream at the read itself, exactly as before.
 */
function linkedWithin(root, absolute) {
  let existing = false;
  try {
    existing = existsSync(absolute);
  } catch {
    return absolute;
  }
  if (!existing) return absolute;
  // Real-to-real: the root itself may be reached through a link (a managed
  // checkout that is itself a symlink), so both sides resolve before the
  // comparison — otherwise a legitimate tree fails its own jail.
  try {
    return within(realpathSync(root), realpathSync(absolute)) ? absolute : null;
  } catch {
    try {
      return within(root, realpathSync(absolute)) ? absolute : null;
    } catch {
      return absolute;
    }
  }
}

/** True when `candidate` jails cleanly under `rootPath` (or the allowlist). */
export function isPathWithinRoot(rootPath, candidate, opts = {}) {
  return resolveWithinRoot(rootPath, candidate, opts) !== null;
}
