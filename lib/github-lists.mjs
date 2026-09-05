/**
 * Sorted-union for GitHub picker lists. Pure logic, no BB host dependency.
 *
 * Context: the import dialog offers alphabetical pickers over "existing"
 * things — assignable users and repo labels from the GitHub plugin,
 * merged with whatever the cached issues already carry. The GitHub RPCs
 * are fail-soft (a repo may reject), so inputs can be anything: non-arrays
 * are ignored, non-strings are dropped, blanks are trimmed out.
 */

export function sortedUnion(lists) {
  const seen = new Set();
  const input = Array.isArray(lists) ? lists : [lists];
  for (const list of input) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry !== "string") continue;
      const value = entry.trim();
      if (value) seen.add(value);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
