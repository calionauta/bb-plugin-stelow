import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StartImmediatelyCheck } from "./start-immediately-check";

export type GithubStatus = {
  ok: boolean;
  pluginAvailable: boolean;
  ghOk: boolean;
  repos: Array<{ repo: string; projectId: string | null }>;
};

export type GithubProject = { id: string; name: string };

type GithubCandidate = {
  repo: string;
  number: number;
  title: string;
  labels: string[];
  author: string;
  assignees: string[];
  url: string;
  body: string;
  updatedAt: string;
  projectId: string | null;
  alreadyImported: boolean;
  cardId: string | null;
  cardName: string | null;
  cardStatus: string | null;
  postedAt: number | null;
  related: string[];
};

type AutomationRule = { id: string; projectId: string; labels: string[]; trustedAuthors: string[]; promptTemplate: string; startImmediate: boolean; enabled: boolean };

// Run outcomes in plain words; null predates outcome tracking.
const RULE_RUN_OUTCOME: Record<string, string> = {
  started: "Started",
  parked: "Parked",
  "already-imported": "Already imported",
};

// Dry-run skip reasons in plain language (server sends the codes).
const RULE_SKIP_REASON: Record<string, string> = {
  "missing-labels": "missing a watched label",
  "other-project": "belongs to another project",
  "already-fired": "already drafted by a rule",
  "already-imported": "already imported",
};

export function GithubIssuesDialog({ open, onOpenChange, projects, activeProjectId, activeProjectName, githubStatus, onChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: GithubProject[];
  activeProjectId: string | null;
  activeProjectName: string | null;
  githubStatus: GithubStatus | null;
  onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [githubTab, setGithubTab] = useState<"import" | "auto">("import");
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [automationLabelInput, setAutomationLabelInput] = useState("stelow-work");
  const [automationAuthorsInput, setAutomationAuthorsInput] = useState("");
  const [automationPromptInput, setAutomationPromptInput] = useState("");
  const [automationStart, setAutomationStart] = useState(false);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [rulePreview, setRulePreview] = useState<{ labels: string[]; matches: Array<{ repo: string; number: number; title: string; url: string; author: string }>; skipped: Array<{ repo: string; number: number; title: string; reason: string }> } | null>(null);
  const [rulePreviewBusy, setRulePreviewBusy] = useState(false);
  const [ruleRuns, setRuleRuns] = useState<Record<string, Array<{ sourceKey: string; repo: string; number: number; cardName: string | null; cardStatus: string | null; outcome: string | null; firedAt: number }>>>({});
  const [runsOpen, setRunsOpen] = useState<Record<string, boolean>>({});
  const [importLabels, setImportLabels] = useState<string[]>(["stelow-work"]);
  const [importLabelInput, setImportLabelInput] = useState("stelow-work");
  const [importCandidates, setImportCandidates] = useState<GithubCandidate[]>([]);
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importAllLabels, setImportAllLabels] = useState<string[]>([]);
  const [importAllAssignees, setImportAllAssignees] = useState<string[]>([]);
  const [importAssignee, setImportAssignee] = useState<string>("all");
  const [importProject, setImportProject] = useState<string>("all");
  const [importStart, setImportStart] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  async function refreshAutomationRules() {
    if (!activeProjectId) { setAutomationRules([]); return; }
    try {
      const result = await rpc.call("listAutomationRules", { projectId: activeProjectId });
      setAutomationRules(result.rules);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load automation rules."); }
  }

  function addImportLabel(raw: string) {
    const clean = raw.trim();
    if (!clean || importLabels.includes(clean)) return;
    setImportLabels((prev) => [...prev, clean].slice(0, 10));
  }

  function parseAutomationForm(): string[] {
    return automationLabelInput.split(",").map((entry) => entry.trim()).filter(Boolean).slice(0, 10);
  }

  async function saveAutomationRule() {
    if (!activeProjectId) return;
    const labels = parseAutomationForm();
    if (labels.length === 0) return;
    const authors = automationAuthorsInput.split(",").map((entry) => entry.trim().replace(/^@/, "")).filter(Boolean);
    setAutomationBusy(true);
    try {
      const saved = await rpc.call("saveAutomationRule", { projectId: activeProjectId, labels, trustedAuthors: authors, promptTemplate: automationPromptInput.trim(), enabled: true, startImmediate: automationStart });
      const result = await rpc.call("listAutomationRules", { projectId: activeProjectId });
      setAutomationRules(result.rules);
      toast.success(saved.primed > 0
        ? `Rule saved. ${saved.primed} already-tagged issue${saved.primed === 1 ? " is" : "s are"} marked as seen — only new ones will draft.`
        : automationStart ? "Rule saved. Matching issues start workers in isolated worktrees." : "Rule saved. Matching issues park as Inbox drafts.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save automation rule."); }
    finally { setAutomationBusy(false); }
  }

  async function setAutomationRule(rule: { id: string; enabled: boolean }, enabled: boolean) {
    const current = automationRules.find((entry) => entry.id === rule.id);
    if (!current) return;
    try {
      // Pass everything through: the toggle must never wipe the rule's
      // labels, authors, template, or start policy.
      const result = await rpc.call("saveAutomationRule", { id: current.id, projectId: current.projectId, labels: current.labels, trustedAuthors: current.trustedAuthors, promptTemplate: current.promptTemplate, enabled, startImmediate: current.startImmediate });
      setAutomationRules((rules) => rules.map((entry) => entry.id === rule.id ? result.rule : entry));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update automation rule."); }
  }

  async function previewRule(labels: string[], authors: string[] = []) {
    if (!activeProjectId || labels.length === 0) return toast.error("Pick at least one label to preview.");
    setRulePreviewBusy(true);
    try {
      const result = await rpc.call("previewAutomationRule", { projectId: activeProjectId, labels, trustedAuthors: authors });
      setRulePreview({ labels, matches: result.matches, skipped: result.skipped });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to preview rule matches."); }
    finally { setRulePreviewBusy(false); }
  }

  async function toggleRuleRuns(ruleId: string) {
    const open = !runsOpen[ruleId];
    setRunsOpen((prev) => ({ ...prev, [ruleId]: open }));
    if (open && !ruleRuns[ruleId]) {
      try {
        const result = await rpc.call("listAutomationRuleRuns", { ruleId, limit: 20 });
        setRuleRuns((prev) => ({ ...prev, [ruleId]: result.runs }));
      } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load rule runs."); }
    }
  }

  async function deleteAutomationRule(ruleId: string) {
    try {
      await rpc.call("deleteAutomationRule", { id: ruleId });
      setAutomationRules((rules) => rules.filter((entry) => entry.id !== ruleId));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to delete automation rule."); }
  }

  async function listGithubIssues() {
    const labels = importLabels.map((entry) => entry.trim()).filter(Boolean);
    if (labels.length === 0) return toast.error("Pick at least one label.");
    setImportBusy(true);
    setImportCandidates([]);
    setImportSelected({});
    try {
      const result = await rpc.call("listGithubCandidates", { labels });
      setImportCandidates(result.issues);
      setImportAllLabels(result.allLabels);
      setImportAllAssignees(result.allAssignees);
      // Preselect only issues not yet imported, so the flow is a one-click
      // "bring in everything tagged" rather than a long checklist.
      const fresh: Record<string, boolean> = {};
      for (const issue of result.issues) if (!issue.alreadyImported) fresh[`${issue.repo}#${issue.number}`] = true;
      setImportSelected(fresh);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to list GitHub issues.");
    } finally {
      setImportBusy(false);
    }
  }

  // Client-side narrowing over the label-filtered candidates.
  const importVisible = importCandidates.filter((issue) => {
    if (importAssignee !== "all" && !(issue.assignees ?? []).includes(importAssignee)) return false;
    if (importProject !== "all" && (issue.projectId ?? "unmapped") !== importProject) return false;
    return true;
  });

  async function importSelectedIssues() {
    const chosen = importVisible.filter((issue) => importSelected[`${issue.repo}#${issue.number}`]);
    if (chosen.length === 0) return toast.error("No issues selected.");
    const labels = importLabels.map((entry) => entry.trim()).filter(Boolean);
    setImportBusy(true);
    let imported = 0;
    let inFlight = 0;
    for (const issue of chosen) {
      try {
        // The server resolves each issue's owning project from its repo; no
        // per-issue picker needed. Intent is derived server-side.
        const result = await rpc.call("importGithubIssue", { repo: issue.repo, number: issue.number, labels, start: importStart });
        if (result.ok && !result.skipped) imported += 1;
        else if (result.skipped === "in-flight") inFlight += 1;
      } catch (error) {
        toast.error(`Issue ${issue.repo}#${issue.number}: ${error instanceof Error ? error.message : "import failed"}`);
      }
    }
    setImportBusy(false);
    onOpenChange(false);
    if (imported > 0) {
      toast.success(importStart ? `Imported and started ${imported} issue${imported === 1 ? "" : "s"}.` : `Parked ${imported} issue${imported === 1 ? "" : "s"} in Inbox.`);
      onChanged();
    }
    if (inFlight > 0) toast.success(`${inFlight} already being imported — refresh to see ${inFlight === 1 ? "it" : "them"}.`);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setImportCandidates([]);
      setRulePreview(null);
      setRuleRuns({});
      setRunsOpen({});
    }
  }

  useEffect(() => {
    if (!open) return;
    if (githubTab === "import") void listGithubIssues();
    else void refreshAutomationRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>GitHub issues</DialogTitle>
          <DialogDescription>Bring tagged issues into Stelow as cards. Import now while you watch, or watch labels automatically per project.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-11 gap-1 rounded-md border p-1" aria-label="GitHub sections">
          {(["import", "auto"] as const).map((tab) => (
            <button key={tab} onClick={() => { setGithubTab(tab); setRulePreview(null); if (tab === "import") void listGithubIssues(); else void refreshAutomationRules(); }} aria-pressed={githubTab === tab} className={`inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded px-3 text-sm font-medium ${githubTab === tab ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}>{tab === "import" ? "Import now" : "Auto-import"}</button>
          ))}
        </div>
        {githubTab === "import" ? (
        <div className="flex flex-col gap-3 py-2">
          {githubStatus !== null && !githubStatus.pluginAvailable ? (
            <p className="rounded-md border p-2 text-xs text-amber-700 dark:text-amber-300">Import needs the <span className="font-medium">github</span> plugin running. Auto-import rules below still work once it is back.</p>
          ) : null}
          {githubStatus !== null && githubStatus.pluginAvailable && !githubStatus.ghOk ? (
            <p className="rounded-md border p-2 text-xs text-amber-700 dark:text-amber-300">Import needs a GitHub account linked in the <span className="font-medium">github</span> plugin.</p>
          ) : null}
          <div className="flex flex-wrap gap-1.5" aria-label="Watched labels">
            {importLabels.map((entry) => (
              <span key={entry} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary">{entry}<button onClick={() => setImportLabels((prev) => prev.filter((item) => item !== entry))} className="cursor-pointer rounded-full px-1 hover:bg-primary/20" aria-label={`Remove label ${entry}`}>×</button></span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Input value={importLabelInput} onChange={(event) => setImportLabelInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addImportLabel(importLabelInput); setImportLabelInput(""); } }} placeholder="stelow-work" aria-label="Add GitHub label" className="sm:w-52" list="stelow-import-labels" autoComplete="off" />
              <datalist id="stelow-import-labels">
                {importAllLabels.map((label) => <option key={label} value={label} />)}
              </datalist>
              <Button size="sm" variant="outline" onClick={() => { addImportLabel(importLabelInput); setImportLabelInput(""); }}>Add</Button>
            </div>
            <select aria-label="Project" className="h-11 cursor-pointer rounded-md border bg-background px-2 text-sm" value={importProject} onChange={(event) => setImportProject(event.target.value)}>
              <option value="all">All projects</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              <option value="unmapped">Unmapped repos</option>
            </select>
            {importAllAssignees.length > 0 ? (
              <select aria-label="Assignee" className="h-11 cursor-pointer rounded-md border bg-background px-2 text-sm" value={importAssignee} onChange={(event) => setImportAssignee(event.target.value)}>
                <option value="all">Everyone</option>
                {importAllAssignees.map((login) => <option key={login} value={login}>{login}</option>)}
              </select>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void listGithubIssues()} disabled={importBusy}>Refresh</Button>
          </div>
          <p className="text-xs text-muted-foreground">An issue matches when it carries every label above. Each match lands in the bb project that owns its repository.</p>
          {importBusy ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {!importBusy && importCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open issues carry {importLabels.join(" + ") || "these labels"} yet. Tag an issue on GitHub, then Refresh.</p>
          ) : null}
          {!importBusy && importCandidates.length > 0 && importVisible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matches under the current project/assignee filter.</p>
          ) : null}
          {importVisible.length > 0 ? (
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
          ) : null}
          <StartImmediatelyCheck checked={importStart} onChange={setImportStart} />
        </div>
        ) : (
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">Rules are scoped to {activeProjectName ?? "this project"}. A matching issue needs every watched label (exact, case-sensitive). Unchecked parks an Inbox draft; checked starts the worker in an isolated worktree (needs a New-worktree preset in Agent Presets). Saving marks already-tagged issues as seen — only new ones draft. An empty author filter means anyone; issue text is untrusted input either way.</p>
          {automationRules.length ? <div className="divide-y rounded-md border">{automationRules.map((rule) => (
            <div key={rule.id} className="space-y-1 p-2 text-sm">
              <div className="flex min-h-11 items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={rule.promptTemplate || undefined}>{rule.labels.join(" + ")}{rule.trustedAuthors.length > 0 ? ` · @${rule.trustedAuthors.join(" @")}` : ""} → {rule.startImmediate ? "Start worker" : "Inbox draft"}{rule.enabled ? "" : " (disabled)"}</span>
                <button className="min-h-11 cursor-pointer rounded px-2 text-xs font-medium text-primary hover:bg-muted" onClick={() => void setAutomationRule(rule, !rule.enabled)}>{rule.enabled ? "Disable" : "Enable"}</button>
                <button className="min-h-11 cursor-pointer rounded px-2 text-xs text-destructive hover:bg-muted" onClick={() => void deleteAutomationRule(rule.id)}>Delete</button>
              </div>
              <div className="flex items-center gap-3 pl-1">
                <button className="cursor-pointer rounded text-xs font-medium text-primary hover:underline" onClick={() => void previewRule(rule.labels, rule.trustedAuthors)}>Check what would match</button>
                <button className="cursor-pointer rounded text-xs font-medium text-primary hover:underline" onClick={() => void toggleRuleRuns(rule.id)}>{runsOpen[rule.id] ? "Hide runs" : "Runs"}</button>
              </div>
              {runsOpen[rule.id] ? (
                <div className="rounded-md bg-muted/30 p-2 text-xs">
                  {!ruleRuns[rule.id] ? <p className="text-muted-foreground">Loading…</p>
                  : ruleRuns[rule.id]!.length === 0 ? <p className="text-muted-foreground">No drafts yet — new matches will appear here.</p>
                  : <ul className="max-h-32 space-y-1 overflow-y-auto">
                      {ruleRuns[rule.id]!.map((run) => <li key={run.sourceKey} className="truncate">{run.repo}#{run.number}{run.cardName ? ` → ${run.cardName}` : ""}{run.cardStatus ? ` (${run.cardStatus})` : ""}{run.outcome ? ` · ${RULE_RUN_OUTCOME[run.outcome] ?? run.outcome}` : ""}</li>)}
                    </ul>}
                </div>
              ) : null}
            </div>
          ))}</div> : <p className="text-sm text-muted-foreground">No rules for this project yet.</p>}
          {rulePreview ? (
            <div className="space-y-1 rounded-md border p-2 text-sm">
              <p className="font-medium">Would draft now ({rulePreview.labels.join(" + ")}): {rulePreview.matches.length}</p>
              {rulePreview.matches.length > 0 ? (
                <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
                  {rulePreview.matches.slice(0, 10).map((issue) => <li key={`${issue.repo}#${issue.number}`} className="truncate">{issue.title} <span className="text-muted-foreground">{issue.repo}#{issue.number}</span></li>)}
                </ul>
              ) : <p className="text-xs text-muted-foreground">Nothing matches right now.</p>}
              {rulePreview.skipped.length > 0 ? <p className="text-xs text-muted-foreground">{rulePreview.skipped.slice(0, 5).map((issue) => `${issue.repo}#${issue.number} (${RULE_SKIP_REASON[issue.reason] ?? issue.reason})`).join(" · ")}{rulePreview.skipped.length > 5 ? ` · +${rulePreview.skipped.length - 5} more` : ""}</p> : null}
              <button className="cursor-pointer rounded text-xs font-medium text-primary hover:underline" onClick={() => setRulePreview(null)}>Clear preview</button>
            </div>
          ) : null}
          <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">GitHub labels (comma-separated, all required, exact case)</span><Input value={automationLabelInput} onChange={(event) => setAutomationLabelInput(event.target.value)} placeholder="stelow-work, bug" /></label>
          <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Only these authors (comma-separated, empty means anyone)</span><Input value={automationAuthorsInput} onChange={(event) => setAutomationAuthorsInput(event.target.value)} placeholder="octocat" autoComplete="off" /></label>
          <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Worker instructions (optional, appended to the issue prompt)</span><Input value={automationPromptInput} onChange={(event) => setAutomationPromptInput(event.target.value)} placeholder="Reproduce first and write a report before fixing." autoComplete="off" /></label>
          <StartImmediatelyCheck checked={automationStart} onChange={setAutomationStart} />
          <div><Button size="sm" variant="outline" onClick={() => void previewRule(parseAutomationForm(), automationAuthorsInput.split(",").map((entry) => entry.trim().replace(/^@/, "")).filter(Boolean))} disabled={rulePreviewBusy || !automationLabelInput.trim()}>{rulePreviewBusy ? "Checking…" : "Preview matches"}</Button></div>
        </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={importBusy || automationBusy}>Cancel</Button>
          </DialogClose>
          {githubTab === "import"
            ? <Button onClick={() => void importSelectedIssues()} disabled={importBusy}>{importStart ? "Import and start" : "Park in Inbox"}</Button>
            : <Button disabled={automationBusy || !automationLabelInput.trim() || !activeProjectId} onClick={() => void saveAutomationRule()}>{automationBusy ? "Saving…" : "Add rule"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
