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

// Client-side narrowing over label-filtered candidates: assignee and
// project picks. Repos without a bb project read as "unmapped" so the
// filter can isolate them. Non-array input narrows to nothing.
export function filterImportCandidates(candidates, { assignee = "all", project = "all" } = {}) {
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((issue) => {
    if (assignee !== "all" && !(issue.assignees ?? []).includes(assignee)) return false;
    if (project !== "all" && (issue.projectId ?? "unmapped") !== project) return false;
    return true;
  });
}

// Preselect only issues not yet imported, so the flow stays a one-click
// "bring in everything tagged" rather than a long checklist.
export function preselectFreshIssues(issues) {
  const fresh = {};
  if (!Array.isArray(issues)) return fresh;
  for (const issue of issues) {
    if (!issue.alreadyImported) fresh[`${issue.repo}#${issue.number}`] = true;
  }
  return fresh;
}
