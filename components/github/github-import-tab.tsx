import { Button } from "@/components/ui/button";
import { StartImmediatelyCheck } from "../start-immediately-check";
import { IsolatedWorktreeCheck } from "../isolated-worktree-check";
import { LabelChipsField, ProjectFilterSelect } from "../github-filter-fields";
import type { GithubImportTabState, GithubStatus } from "./github-dialog-state";

// Import-now tab: label-filtered open issues with project/assignee
// narrowing, one-click preselect of the not-yet-imported, and the
// start/isolated choices. Reads its state from the dialog hook.

// Filter row: project scope, assignee narrowing (when any exist), and
// manual refresh. Client-side narrowing over label-filtered candidates.
function GithubImportFilters({ tab }: { tab: GithubImportTabState }) {
  const {
    projects,
    importAllAssignees,
    importAssignee, setImportAssignee,
    importProject, setImportProject,
    importBusy, listGithubIssues,
  } = tab;
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:gap-2">
      <ProjectFilterSelect
        projects={projects}
        value={importProject}
        onChange={setImportProject}
        label="Project"
        allowAll
        extraOptions={[{ value: "unmapped", label: "Unmapped repos" }]}
      />
      {importAllAssignees.length > 0 ? (
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground"><span>Assignee</span>
          <select aria-label="Assignee" className="h-11 w-full cursor-pointer rounded-md border bg-background px-2 text-sm font-normal text-foreground" value={importAssignee} onChange={(event) => setImportAssignee(event.target.value)}>
            <option value="all">Everyone</option>
            {importAllAssignees.map((login) => <option key={login} value={login}>{login}</option>)}
          </select>
        </label>
      ) : null}
      <Button variant="outline" className="h-11 sm:w-auto" onClick={() => void listGithubIssues()} disabled={importBusy}>Refresh</Button>
    </div>
  );
}

// Candidate list: one checkbox row per visible issue, preselected when not
// yet imported. Already-imported rows render disabled, never selectable.
function GithubImportCandidates({ tab }: { tab: GithubImportTabState }) {
  const { projects, importVisible, importSelected, setImportSelected } = tab;
  if (importVisible.length === 0) return null;
  return (
    <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border">
      {importVisible.map((issue) => {
        const key = `${issue.repo}#${issue.number}`;
        return (
          <li key={key} className="flex items-start gap-2 p-2">
            <input
              className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
              type="checkbox"
              checked={Boolean(importSelected[key])}
              onChange={() => setImportSelected((prev) => ({ ...prev, [key]: !prev[key] }))}
              disabled={issue.alreadyImported}
            />
            <div className="min-w-0">
              <p className="text-sm leading-5">
                <span className="font-medium">{issue.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">{issue.repo}#{issue.number}</span>
              </p>
              <p className="text-xs text-muted-foreground">{issue.labels.join(" · ") || "no labels"} · by @{issue.author}{(issue.assignees ?? []).length > 0 ? ` · assigned @${(issue.assignees ?? []).join(" @")}` : ""}{issue.projectId ? ` → ${projects.find((project) => project.id === issue.projectId)?.name ?? issue.projectId}` : " → unmapped"}{issue.alreadyImported ? ` · imported${issue.cardStatus ? ` (${issue.cardStatus})` : ""}${issue.postedAt ? " · ✓ posted" : ""}` : ""}{issue.related.length > 0 ? ` · possibly related: ${issue.related.join(", ")}` : ""}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function GithubImportTab({ tab, githubStatus }: { tab: GithubImportTabState; githubStatus: GithubStatus | null }) {
  const {
    importLabels, setImportLabels,
    importCandidates,
    importAllLabels,
    importStart, setImportStart,
    importIsolated, setImportIsolated,
    importBusy, importVisible,
    listGithubIssues,
  } = tab;
  return (
    <div className="flex flex-col gap-3 py-2">
      {githubStatus !== null && !githubStatus.pluginAvailable ? (
        <p className="rounded-md border p-2 text-xs text-amber-700 dark:text-amber-300">Import needs the <span className="font-medium">github</span> plugin running. Auto-import rules below still work once it is back.</p>
      ) : null}
      {githubStatus !== null && githubStatus.pluginAvailable && !githubStatus.ghOk ? (
        <p className="rounded-md border p-2 text-xs text-amber-700 dark:text-amber-300">Import needs a GitHub account linked in the <span className="font-medium">github</span> plugin.</p>
      ) : null}
      <LabelChipsField
        labels={importLabels}
        onChange={(next) => { setImportLabels(next); void listGithubIssues(next); }}
        suggestions={importAllLabels}
        listId="stelow-import-labels"
        label="Labels to watch"
        hint="An issue matches when it carries every label above. Changing labels re-searches at once."
      />
      <GithubImportFilters tab={tab} />
      <p className="text-xs text-muted-foreground">An issue matches when it carries every label above. Each match lands in the bb project that owns its repository.</p>
      {importBusy ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {!importBusy && importCandidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open issues carry {importLabels.join(" + ") || "these labels"} yet. Tag an issue on GitHub, then Refresh.</p>
      ) : null}
      {!importBusy && importCandidates.length > 0 && importVisible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches under the current project/assignee filter.</p>
      ) : null}
      <GithubImportCandidates tab={tab} />
      <StartImmediatelyCheck checked={importStart} onChange={setImportStart} />
      <IsolatedWorktreeCheck checked={importIsolated} onChange={setImportIsolated} />
    </div>
  );
}
