/**
 * Unified-diff splitting. Pure: `git diff` output in, per-file entries out.
 * Bounds keep card payloads small: at most MAX_DIFF_FILES files, each patch
 * truncated to MAX_PATCH_CHARS with truncated=true. Garbage in yields
 * zero files, never a throw — the Diff section renders "no changes".
 */

export const MAX_DIFF_FILES = 20;
export const MAX_PATCH_CHARS = 50000;

const DIFF_GIT_RE = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)\s*$/;

/**
 * Split a unified diff into [{ path, patch }]. Path prefers the b/ side
 * (post-image, correct for renames); /dev/null sides mean created/deleted
 * but the file still lists under its real path.
 */
export function splitDiffByFile(patchText) {
  const out = [];
  if (typeof patchText !== "string" || patchText.length === 0) return { files: out, truncated: false };
  const lines = patchText.split("\n");
  let current = null;
  const push = () => {
    if (current) {
      const patch = current.lines.join("\n");
      out.push({
        path: current.path,
        patch: patch.length > MAX_PATCH_CHARS ? patch.slice(0, MAX_PATCH_CHARS) : patch,
        truncated: patch.length > MAX_PATCH_CHARS,
      });
      current = null;
    }
  };
  for (const line of lines) {
    const match = DIFF_GIT_RE.exec(line);
    if (match) {
      push();
      const a = match[1] ?? "";
      const b = match[2] ?? "";
      const path = b !== "/dev/null" ? b : a;
      if (!path || path === "/dev/null") {
        current = null;
        continue;
      }
      current = { path, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  push();
  const truncated = out.length > MAX_DIFF_FILES;
  return { files: out.slice(0, MAX_DIFF_FILES), truncated };
}
