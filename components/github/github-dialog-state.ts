import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import { filterImportCandidates, preselectFreshIssues } from "../../lib/github-lists.mjs";

// Dialog state: every tab state, RPC handler, and open/close choreography
// for the GitHub dialog. The shell owns the frame, each tab owns its
// render; both read from here, so tab switches and re-opens see one
// consistent state instead of two drifting copies.

export type GithubStatus = {
  ok: boolean;
  pluginAvailable: boolean;
  ghOk: boolean;
  repos: Array<{ repo: string; projectId: string | null }>;
};

export type GithubProject = { id: string; name: string };

export type GithubCandidate = {
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

export type AutomationRule = { id: string; projectId: string; labels: string[]; trustedAuthors: string[]; promptTemplate: string; startImmediate: boolean; enabled: boolean };

export type RulePreview = {
  labels: string[];
  matches: Array<{ repo: string; number: number; title: string; url: string; author: string }>;
  skipped: Array<{ repo: string; number: number; title: string; reason: string; owner: string | null }>;
};

export type RuleRunEntry = { sourceKey: string; repo: string; number: number; cardName: string | null; cardStatus: string | null; outcome: string | null; firedAt: number };

// Run outcomes in plain words; null predates outcome tracking.
export const RULE_RUN_OUTCOME: Record<string, string> = {
  started: "Started",
  parked: "Parked",
  "already-imported": "Already imported",
};

// Dry-run skip reasons in plain language (server sends the codes).
export const RULE_SKIP_REASON: Record<string, string> = {
  "missing-labels": "missing a watched label",
  "other-project": "belongs to another project",
  "already-fired": "already drafted by a rule",
  "already-imported": "already imported",
};

export type GithubImportTabState = {
  projects: GithubProject[];
  importLabels: string[];
  setImportLabels: (labels: string[]) => void;
  importCandidates: GithubCandidate[];
  importSelected: Record<string, boolean>;
  setImportSelected: (next: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  importAllLabels: string[];
  importAllAssignees: string[];
  importAssignee: string;
  setImportAssignee: (value: string) => void;
  importProject: string;
  setImportProject: (value: string) => void;
  importStart: boolean;
  setImportStart: (value: boolean) => void;
  importIsolated: boolean;
  setImportIsolated: (value: boolean) => void;
  importBusy: boolean;
  importVisible: GithubCandidate[];
  listGithubIssues: (explicit?: string[]) => Promise<void>;
  importSelectedIssues: () => Promise<void>;
};

export type GithubAutomationTabState = {
  projects: GithubProject[];
  automationRules: AutomationRule[];
  automationLabels: string[];
  setAutomationLabels: (labels: string[]) => void;
  automationAuthorsInput: string;
  setAutomationAuthorsInput: (value: string) => void;
  automationPromptInput: string;
  setAutomationPromptInput: (value: string) => void;
  automationStart: boolean;
  setAutomationStart: (value: boolean) => void;
  automationBusy: boolean;
  rulePreview: RulePreview | null;
  setRulePreview: (preview: RulePreview | null) => void;
  rulePreviewBusy: boolean;
  ruleRuns: Record<string, RuleRunEntry[]>;
  runsOpen: Record<string, boolean>;
  ruleProjectId: string | null;
  setRuleProjectId: (id: string | null) => void;
  ruleProjectName: string | null;
  importAllLabels: string[];
  refreshAutomationRules: (projectId?: string | null) => Promise<void>;
  parseAutomationForm: () => string[];
  saveAutomationRule: () => Promise<void>;
  setAutomationRule: (rule: { id: string; enabled: boolean }, enabled: boolean) => Promise<void>;
  previewRule: (labels: string[], authors?: string[]) => Promise<void>;
  toggleRuleRuns: (ruleId: string) => Promise<void>;
  deleteAutomationRule: (ruleId: string) => Promise<void>;
};

// Exception to the 50-line function rule (2026-09-23, reaffirmed after
// extracting the two testable pure units to lib/github-lists.mjs): this
// hook is a composition root, not branching logic — 22 useState declarations
// plus single-purpose RPC handlers (each ≤30 lines) plus tab-switch
// choreography that must see both tabs at once. Splitting it per tab would
// duplicate the open/re-anchor/switch coordination or hide it behind
// indirection. Revisit if a third tab arrives.
export function useGithubDialogState({ projects, activeProjectId, onChanged, onOpenChange, open }: {
  projects: GithubProject[];
  activeProjectId: string | null;
  onChanged: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [githubTab, setGithubTab] = useState<"import" | "auto">("import");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [automationLabels, setAutomationLabels] = useState<string[]>(["stelow-work"]);
  const [automationAuthorsInput, setAutomationAuthorsInput] = useState("");
  const [automationPromptInput, setAutomationPromptInput] = useState("");
  const [automationStart, setAutomationStart] = useState(false);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [rulePreview, setRulePreview] = useState<RulePreview | null>(null);
  const [rulePreviewBusy, setRulePreviewBusy] = useState(false);
  const [ruleRuns, setRuleRuns] = useState<Record<string, RuleRunEntry[]>>({});
  const [runsOpen, setRunsOpen] = useState<Record<string, boolean>>({});
  const [importLabels, setImportLabels] = useState<string[]>(["stelow-work"]);
  const [importCandidates, setImportCandidates] = useState<GithubCandidate[]>([]);
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importAllLabels, setImportAllLabels] = useState<string[]>([]);
  const [importAllAssignees, setImportAllAssignees] = useState<string[]>([]);
  const [importAssignee, setImportAssignee] = useState<string>("all");
  const [importProject, setImportProject] = useState<string>("all");
  const [importStart, setImportStart] = useState(false);
  const [importIsolated, setImportIsolated] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  // Rules live on one project. The board's active project is only the
  // default — the picker below lets automation cover any project, including
  // when the dialog opens from a board with none active.
  const [ruleProjectId, setRuleProjectId] = useState<string | null>(activeProjectId);
  // The save names its project, so carried-over labels can never silently
  // land a rule on the wrong one — the target reads on the button itself.
  const ruleProjectName = projects.find((project) => project.id === ruleProjectId)?.name ?? null;
  async function refreshAutomationRules(projectId: string | null = ruleProjectId) {
    if (!projectId) { setAutomationRules([]); return; }
    try {
      const result = await rpc.call("listAutomationRules", { projectId });
      setAutomationRules(result.rules);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load automation rules."); }
  }

  function parseAutomationForm(): string[] {
    return automationLabels;
  }

  async function saveAutomationRule() {
    if (!ruleProjectId) return;
    const labels = parseAutomationForm();
    if (labels.length === 0) return;
    const authors = automationAuthorsInput.split(",").map((entry) => entry.trim().replace(/^@/, "")).filter(Boolean);
    setAutomationBusy(true);
    try {
      const saved = await rpc.call("saveAutomationRule", { projectId: ruleProjectId, labels, trustedAuthors: authors, promptTemplate: automationPromptInput.trim(), enabled: true, startImmediate: automationStart });
      const result = await rpc.call("listAutomationRules", { projectId: ruleProjectId });
      setAutomationRules(result.rules);
      toast.success(saved.primed > 0
        ? `Rule saved. ${saved.primed} already-tagged issue${saved.primed === 1 ? " is" : "s are"} marked as seen — only new ones will draft.`
        : automationStart ? "Rule saved. Matching issues start workers in isolated worktrees." : "Rule saved. Matching issues park as Bucket drafts.");
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
    if (!ruleProjectId || labels.length === 0) {
      toast.error("Pick a project and at least one label to preview.");
      return;
    }
    setRulePreviewBusy(true);
    try {
      const result = await rpc.call("previewAutomationRule", { projectId: ruleProjectId, labels, trustedAuthors: authors });
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

  async function listGithubIssues(explicit?: string[]) {
    const labels = (explicit ?? importLabels).map((entry) => entry.trim()).filter(Boolean);
    if (labels.length === 0) {
      // No query without labels: clear stale results instead of erroring on
      // every chip removal — the field below explains what to do.
      setImportCandidates([]);
      setImportSelected({});
      return;
    }
    setImportBusy(true);
    setImportCandidates([]);
    setImportSelected({});
    try {
      const result = await rpc.call("listGithubCandidates", { labels });
      setImportCandidates(result.issues);
      setImportAllLabels(result.allLabels);
      setImportAllAssignees(result.allAssignees);
      // Preselect only issues not yet imported (lib, tested), so the flow
      // is a one-click "bring in everything tagged" rather than a long
      // checklist.
      setImportSelected(preselectFreshIssues(result.issues));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to list GitHub issues.");
    } finally {
      setImportBusy(false);
    }
  }

  // Client-side narrowing over the label-filtered candidates (lib,
  // tested: assignee/project picks, unmapped isolation, fail-soft).
  const importVisible = filterImportCandidates<GithubCandidate>(importCandidates, { assignee: importAssignee, project: importProject });

  async function importSelectedIssues() {
    const chosen = importVisible.filter((issue) => importSelected[`${issue.repo}#${issue.number}`]);
    if (chosen.length === 0) {
      toast.error("No issues selected.");
      return;
    }
    const labels = importLabels.map((entry) => entry.trim()).filter(Boolean);
    setImportBusy(true);
    let imported = 0;
    let inFlight = 0;
    for (const issue of chosen) {
      try {
        // The server resolves each issue's owning project from its repo; no
        // per-issue picker needed. Intent is derived server-side.
        const result = await rpc.call("importGithubIssue", { repo: issue.repo, number: issue.number, labels, start: importStart, isolated: importIsolated });
        if (result.ok && !result.skipped) imported += 1;
        else if (result.skipped === "in-flight") inFlight += 1;
      } catch (error) {
        toast.error(`Issue ${issue.repo}#${issue.number}: ${error instanceof Error ? error.message : "import failed"}`);
      }
    }
    setImportBusy(false);
    onOpenChange(false);
    if (imported > 0) {
      toast.success(importStart ? (importIsolated ? `Imported and started ${imported} issue${imported === 1 ? "" : "s"} in isolated worktrees.` : `Imported and started ${imported} issue${imported === 1 ? "" : "s"}.`) : `Parked ${imported} issue${imported === 1 ? "" : "s"} in Inbox.`);
      onChanged();
    }
    if (inFlight > 0) toast.success(`${inFlight} already being imported — refresh to see ${inFlight === 1 ? "it" : "them"}.`);
  }

  function selectGithubTab(tab: "import" | "auto", focus = false) {
    setGithubTab(tab);
    setRulePreview(null);
    if (tab === "import") void listGithubIssues();
    else void refreshAutomationRules();
    if (focus) tabRefs.current[tab]?.focus();
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
    // The board project is the default, not the scope: re-anchor on every
    // open so a stale pick never writes rules to the wrong project.
    const target = activeProjectId ?? projects[0]?.id ?? null;
    setRuleProjectId(target);
    if (githubTab === "import") void listGithubIssues();
    else void refreshAutomationRules(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const importTab: GithubImportTabState = {
    projects,
    importLabels, setImportLabels,
    importCandidates,
    importSelected, setImportSelected,
    importAllLabels, importAllAssignees,
    importAssignee, setImportAssignee,
    importProject, setImportProject,
    importStart, setImportStart,
    importIsolated, setImportIsolated,
    importBusy, importVisible,
    listGithubIssues, importSelectedIssues,
  };
  const automationTab: GithubAutomationTabState = {
    projects,
    automationRules,
    automationLabels, setAutomationLabels,
    automationAuthorsInput, setAutomationAuthorsInput,
    automationPromptInput, setAutomationPromptInput,
    automationStart, setAutomationStart,
    automationBusy,
    rulePreview, setRulePreview,
    rulePreviewBusy, ruleRuns, runsOpen,
    ruleProjectId, setRuleProjectId, ruleProjectName,
    importAllLabels,
    refreshAutomationRules, parseAutomationForm, saveAutomationRule,
    setAutomationRule, previewRule, toggleRuleRuns, deleteAutomationRule,
  };
  return { githubTab, tabRefs, selectGithubTab, handleOpenChange, importTab, automationTab };
}
