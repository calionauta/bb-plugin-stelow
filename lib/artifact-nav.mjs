/**
 * Path arithmetic for reading one artifact and then following a link to its
 * sibling, purely and without touching the filesystem.
 *
 * The viewer used to be a single-document modal: a brief that named
 * `alternatives.md` or `contrast.json` sent the reader nowhere. The files
 * exist, they are the evidence the question is about, and the only reason
 * they were unreachable is that nothing turned a relative link into the next
 * document. This module is that turn.
 *
 * Two rules, both conservative because the input is worker-authored Markdown:
 *
 * - external links (a scheme, `//host`, or a bare `#anchor`) are not ours;
 * - a target that climbs above its starting root is refused rather than
 *   clamped. The server jails every read again; this mirror exists so a
 *   broken link never becomes a silent read of an unrelated file.
 */

/** Extensions the viewer can show: prose, source, diagrams, and pages. */
const VIEWABLE = /\.(md|mdx|mmd|json|txt|csv|html?)$/i;

/** A URL scheme or protocol-relative host — never a workspace file. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function isViewableArtifactPath(path) {
  return typeof path === "string" && VIEWABLE.test(path.trim());
}

/** The last segment of a path, for a label that need not be a full path. */
export function artifactFileName(path) {
  const clean = typeof path === "string" ? path.replace(/\\/g, "/").replace(/\/+$/, "") : "";
  return clean.split("/").pop() || clean;
}

/**
 * Whether a click on a document link is navigation, and to what.
 *
 * A browser has its own contracts for a modified click, a non-primary button,
 * and an already-handled event; the viewer must not overrule any of them. The
 * decision is pure so the rule can be asserted without a DOM, and the one DOM
 * read (`closest("a")`, `getAttribute("href")`) stays in the caller.
 */
export function artifactLinkTarget(click, currentPath) {
  if (!click || typeof click !== "object") return null;
  if (click.defaultPrevented) return null;
  if (click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  return resolveArtifactLink(currentPath, click.href);
}

/**
 * Resolve `href` against the file that contains it, or null when it is not a
 * workspace document link. Absolute targets stay absolute (the server jails
 * them); relative targets join the current file's directory.
 */
export function resolveArtifactLink(currentPath, href) {
  if (typeof currentPath !== "string" || !currentPath.trim()) return null;
  if (typeof href !== "string") return null;
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || EXTERNAL.test(raw)) return null;
  const withoutHash = raw.split("#")[0].split("?")[0];
  if (!withoutHash) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutHash);
  } catch {
    return null;
  }
  const current = currentPath.replace(/\\/g, "/");
  const joined = decoded.startsWith("/")
    ? decoded
    : `${current.slice(0, current.lastIndexOf("/") + 1)}${decoded}`;
  const resolved = normalize(joined);
  if (!resolved || !isViewableArtifactPath(resolved)) return null;
  return resolved;
}

/** Collapse `.` and `..` without a filesystem; null when `..` escapes the root. */
function normalize(path) {
  const absolute = path.startsWith("/");
  const segments = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) return null;
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}
