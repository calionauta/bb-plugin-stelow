import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StartImmediatelyCheck } from "../start-immediately-check";
import { LabelChipsField, ProjectFilterSelect } from "../github-filter-fields";
import { RULE_RUN_OUTCOME, RULE_SKIP_REASON, type GithubAutomationTabState } from "./github-dialog-state";

// One watcher rule: labels, authors, destination, enable toggle, delete,
// dry-run entry, and its run history behind a toggle.
function AutomationRuleRow({ rule, runsOpen, ruleRuns, onToggleEnabled, onDelete, onPreview, onToggleRuns }: {
  rule: { id: string; labels: string[]; trustedAuthors: string[]; promptTemplate: string; startImmediate: boolean; enabled: boolean };
  runsOpen: boolean;
  ruleRuns: Array<{ sourceKey: string; repo: string; number: number; cardName: string | null; cardStatus: string | null; outcome: string | null }> | undefined;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onPreview: () => void;
  onToggleRuns: () => void;
}) {
  return (
    <div className="space-y-1 p-2 text-sm">
      <div className="flex min-h-11 items-center gap-2">
        <span className="min-w-0 flex-1 truncate" title={rule.promptTemplate || undefined}>{rule.labels.join(" + ")}{rule.trustedAuthors.length > 0 ? ` · @${rule.trustedAuthors.join(" @")}` : ""} → {rule.startImmediate ? "Start worker" : "Bucket draft"}{rule.enabled ? "" : " (disabled)"}</span>
        <button className="min-h-11 cursor-pointer rounded px-2 text-xs font-medium text-primary hover:bg-muted" onClick={onToggleEnabled}>{rule.enabled ? "Disable" : "Enable"}</button>
        <button className="min-h-11 cursor-pointer rounded px-2 text-xs text-destructive hover:bg-muted" onClick={onDelete}>Delete</button>
      </div>
      <div className="flex items-center gap-3 pl-1">
        <button className="cursor-pointer rounded text-xs font-medium text-primary hover:underline" onClick={onPreview}>Check what would match</button>
        <button className="cursor-pointer rounded text-xs font-medium text-primary hover:underline" onClick={onToggleRuns}>{runsOpen ? "Hide runs" : "Runs"}</button>
      </div>
      {runsOpen ? (
        <div className="rounded-md bg-muted/30 p-2 text-xs">
          {!ruleRuns ? <p className="text-muted-foreground">Loading…</p>
          : ruleRuns.length === 0 ? <p className="text-muted-foreground">No drafts yet — new matches will appear here.</p>
          : <ul className="max-h-32 space-y-1 overflow-y-auto">
              {ruleRuns.map((run) => <li key={run.sourceKey} className="truncate">{run.repo}#{run.number}{run.cardName ? ` → ${run.cardName}` : ""}{run.cardStatus ? ` (${run.cardStatus})` : ""}{run.outcome ? ` · ${RULE_RUN_OUTCOME[run.outcome] ?? run.outcome}` : ""}</li>)}
            </ul>}
        </div>
      ) : null}
    </div>
  );
}

// Dry-run preview: what would draft now, what would skip and why, with
// the project name resolved for cross-project skips.
function RulePreviewPanel({ preview, projects, onClear }: {
  preview: { labels: string[]; matches: Array<{ repo: string; number: number; title: string; url: string; author: string }>; skipped: Array<{ repo: string; number: number; title: string; reason: string; owner: string | null }> };
  projects: Array<{ id: string; name: string }>;
  onClear: () => void;
}) {
  return (
    <div className="space-y-1 rounded-md border p-2 text-sm">
      <p className="font-medium">Would draft now ({preview.labels.join(" + ")}): {preview.matches.length}</p>
      {preview.matches.length > 0 ? (
        <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
          {preview.matches.slice(0, 10).map((issue) => <li key={`${issue.repo}#${issue.number}`} className="truncate">{issue.title} <span className="text-muted-foreground">{issue.repo}#{issue.number}</span></li>)}
        </ul>
      ) : <p className="text-xs text-muted-foreground">Nothing matches right now.</p>}
      {preview.skipped.length > 0 ? <p className="text-xs text-muted-foreground">{preview.skipped.slice(0, 5).map((issue) => `${issue.repo}#${issue.number} (${issue.reason === "other-project" && issue.owner ? `belongs to project ${projects.find((project) => project.id === issue.owner)?.name ?? issue.owner}` : (RULE_SKIP_REASON[issue.reason] ?? issue.reason)})`).join(" · ")}{preview.skipped.length > 5 ? ` · +${preview.skipped.length - 5} more` : ""}</p> : null}
      <button className="cursor-pointer rounded text-xs font-medium text-primary hover:underline" onClick={onClear}>Clear preview</button>
    </div>
  );
}

// Project scope header: the picker plus what scoping means, and the
// no-project roadblock when no board or pick covers the rules.
function AutomationProjectHeader({ tab, activeProjectName }: { tab: GithubAutomationTabState; activeProjectName: string | null }) {
  const { projects, ruleProjectId, setRuleProjectId, setRulePreview, refreshAutomationRules } = tab;
  return (
    <>
      <ProjectFilterSelect
        projects={projects}
        value={ruleProjectId ?? ""}
        onChange={(next) => { const id = next === "" ? null : next; setRuleProjectId(id); setRulePreview(null); void refreshAutomationRules(id); }}
        label="Project for new rules"
        allowAll={false}
      />
      <p className="text-xs text-muted-foreground">Rules are scoped to {projects.find((project) => project.id === ruleProjectId)?.name ?? activeProjectName ?? "the picked project"}. A matching issue needs every watched label (exact, case-sensitive). Unchecked parks a Bucket draft; checked starts the worker in an isolated worktree (needs a New-worktree preset in Agent Presets). Saving marks already-tagged issues as seen — only new ones draft. An empty author filter means anyone; issue text is untrusted input either way.</p>
      {ruleProjectId === null ? <p className="text-xs text-muted-foreground" role="status">Pick a project above — rules live on a project, and there is none to scope to yet.</p> : null}
    </>
  );
}

// New-rule composer: labels, author allowlist, worker instructions, the
// start policy, and the dry-run entry — all writing into the same draft
// the save button reads.
function GithubRuleComposer({ tab }: { tab: GithubAutomationTabState }) {
  const {
    automationLabels, setAutomationLabels,
    automationAuthorsInput, setAutomationAuthorsInput,
    automationPromptInput, setAutomationPromptInput,
    automationStart, setAutomationStart,
    setRulePreview,
    importAllLabels, rulePreviewBusy,
    parseAutomationForm, previewRule,
  } = tab;
  return (
    <>
      <LabelChipsField
        labels={automationLabels}
        onChange={(next) => { setAutomationLabels(next); setRulePreview(null); }}
        suggestions={importAllLabels}
        listId="stelow-automation-labels"
        label="GitHub labels"
        hint="All required, exact case. Editing clears the preview below — re-check before saving."
      />
      <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Only these authors (comma-separated, empty means anyone)</span><Input value={automationAuthorsInput} onChange={(event) => setAutomationAuthorsInput(event.target.value)} placeholder="octocat" autoComplete="off" /></label>
      <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Worker instructions (optional, appended to the issue prompt)</span><Input value={automationPromptInput} onChange={(event) => setAutomationPromptInput(event.target.value)} placeholder="Reproduce first and write a report before fixing." autoComplete="off" /></label>
      <StartImmediatelyCheck checked={automationStart} onChange={setAutomationStart} />
      <div><Button size="sm" variant="outline" onClick={() => void previewRule(parseAutomationForm(), automationAuthorsInput.split(",").map((entry) => entry.trim().replace(/^@/, "")).filter(Boolean))} disabled={rulePreviewBusy || automationLabels.length === 0}>{rulePreviewBusy ? "Checking…" : "Preview matches"}</Button></div>
    </>
  );
}

// Auto-import tab: per-project label watchers with dry-run preview, run
// history, and the start/park policy. Reads its state from the dialog hook.

export function GithubAutomationTab({ tab, activeProjectName }: { tab: GithubAutomationTabState; activeProjectName: string | null }) {
  const {
    automationRules,
    rulePreview,
    ruleRuns, runsOpen,
    setAutomationRule, previewRule, toggleRuleRuns, deleteAutomationRule,
  } = tab;
  return (
    <div className="space-y-3 py-2">
      <AutomationProjectHeader tab={tab} activeProjectName={activeProjectName} />
      {automationRules.length ? <div className="divide-y rounded-md border">{automationRules.map((rule) => (
        <AutomationRuleRow
          key={rule.id}
          rule={rule}
          runsOpen={Boolean(runsOpen[rule.id])}
          ruleRuns={ruleRuns[rule.id]}
          onToggleEnabled={() => void setAutomationRule(rule, !rule.enabled)}
          onDelete={() => void deleteAutomationRule(rule.id)}
          onPreview={() => void previewRule(rule.labels, rule.trustedAuthors)}
          onToggleRuns={() => void toggleRuleRuns(rule.id)}
        />
      ))}</div> : <p className="text-sm text-muted-foreground">No rules for this project yet.</p>}
      {rulePreview ? (
        <RulePreviewPanel preview={rulePreview} projects={tab.projects} onClear={() => tab.setRulePreview(null)} />
      ) : null}
      <GithubRuleComposer tab={tab} />
    </div>
  );
}
