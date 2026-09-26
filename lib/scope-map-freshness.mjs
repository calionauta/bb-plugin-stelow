/**
 * Mirror a scope map's Shape version into `state.md`, so freshness is a real
 * signal instead of a permanently dead one.
 *
 * Context: the X-ray reports whether the map still matches the card's current
 * Shape, and it read `shape_version` from `state.md`. Nothing ever wrote that
 * field, so freshness was structurally `unknown` — the X-ray could never say
 * `current` or `stale`, and the honest "I don't know" became permanent rather
 * than occasional. Recording it at the moment the map is approved is what
 * makes the signal live: the map and the card then carry the same version, and
 * a later Shape bump is what turns the reading stale.
 *
 * A no-op when the field already says the same thing, so this never rewrites
 * a file it does not need to touch.
 */

const SHAPE_VERSION_LINE = /^shape_version:.*$/m;

/**
 * @param {string} stateText current `state.md`
 * @param {string | null | undefined} shapeVersion the approved map's shapeVersion
 * @returns {{ text: string, changed: boolean, written: boolean }} `written` is
 *   false when there is no version to record — a map with no version leaves
 *   freshness unknown on purpose rather than inventing one.
 */
export function recordShapeVersion(stateText, shapeVersion) {
  const text = typeof stateText === "string" ? stateText : "";
  const version = typeof shapeVersion === "string" ? shapeVersion.trim() : "";
  if (version.length === 0) return { text, changed: false, written: false };
  const line = `shape_version: ${version}`;
  const match = text.match(SHAPE_VERSION_LINE);
  if (match && match[0] === line) return { text, changed: false, written: true };
  // Only the frontmatter is ours to touch. A state file with no frontmatter
  // block is left exactly as it is rather than gaining a stray key.
  if (!/^---\r?\n/.test(text)) return { text, changed: false, written: false };
  const replaced = match ? text.replace(SHAPE_VERSION_LINE, line) : insertIntoFrontmatter(text, line);
  return { text: replaced, changed: true, written: true };
}

function insertIntoFrontmatter(text, line) {
  const end = text.indexOf("\n---", 3);
  if (end < 0) return text;
  const before = text.slice(0, end);
  const after = text.slice(end);
  return `${before}\n${line}${after}`;
}
