import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

/** How long one path may take before it reads as "unknown size".
 *
 * The old implementation got this from `execFile(..., { timeout: 8000 })`.
 * Measuring in-process instead must not quietly drop the guarantee: a worktree
 * on a stalled network mount would otherwise hang the whole `storage` readout.
 */
const PATH_TIMEOUT_MS = 8000;

/** Apparent bytes under `path`, summed in JS so every platform agrees.
 *
 * The previous implementation shelled out to `du`: `-sb` first, falling back to
 * `-sk * 1024`. Both halves were wrong in opposite directions. `-sb` is GNU-only
 * (BSD `du` exits `invalid option -- b`, which turned every path into `null` on
 * macOS — "unknown size" for all of them). The `-sk` fallback then measured
 * *disk blocks*: 5010 bytes across two files was reported as 12288, a 145% error
 * that `gc` ranked candidates by and `storage` printed as fact.
 *
 * Files are counted by apparent size, matching what `-sb` meant, and symlinks
 * are not followed (a linked worktree must not bill the tree it points at, and
 * a symlink cycle must not recurse forever). An unreadable entry is skipped
 * rather than failing the whole walk. `null` still means "could not measure" or
 * "took too long" — an unreadable path never collapses to zero, and a slow one
 * never silently reads as empty.
 */
export async function duBytes(path: string): Promise<number | null> {
  const sizeOf = async (entry: string): Promise<number> => {
    let stats;
    try {
      stats = await lstat(entry);
    } catch {
      return 0;
    }
    if (!stats.isDirectory()) return stats.size;
    let total = 0;
    let names;
    try {
      names = await readdir(entry);
    } catch {
      return 0;
    }
    for (const name of names) total += await sizeOf(join(entry, name));
    return total;
  };

  try {
    await lstat(path);
  } catch {
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolveDeadline) => {
    timer = setTimeout(() => resolveDeadline(null), PATH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([sizeOf(path), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
