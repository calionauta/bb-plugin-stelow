import type { GithubProject } from "./github-dialog-types";
import { useGithubTabChoreography } from "./github-dialog-tabs";
import { useGithubAutomationTab } from "./github-automation-tab-state";
import { useGithubImportTab } from "./github-import-tab-state";

// Dialog state: the shell owns the frame, each tab owns its state and its
// render, and the tab choreography is the one seam they share — so a tab switch
// and a re-open see one consistent state instead of two drifting copies. The
// two tabs are separate hooks because they have nothing to say to each other;
// what they share is here, once.

export type { GithubAutomationTabState } from "./github-automation-tab-state";
export type { GithubImportTabState } from "./github-import-tab-state";
export { RULE_RUN_OUTCOME, RULE_SKIP_REASON } from "./github-dialog-types";
export type {
  AutomationRule,
  GithubCandidate,
  GithubProject,
  GithubStatus,
  RulePreview,
  RuleRunEntry,
} from "./github-dialog-types";

export function useGithubDialogState({ projects, activeProjectId, onChanged, onOpenChange, open }: {
  projects: GithubProject[];
  activeProjectId: string | null;
  onChanged: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const importTab = useGithubImportTab({ projects, onChanged, onOpenChange });
  const automationTab = useGithubAutomationTab({
    projects,
    activeProjectId,
    importAllLabels: importTab.importAllLabels,
  });
  const tabs = useGithubTabChoreography({
    open,
    activeProjectId,
    projects,
    loadImportTab: () => void importTab.listGithubIssues(),
    loadAutomationTab: () => void automationTab.refreshAutomationRules(),
    anchorAutomationTab: (projectId) => void automationTab.refreshAutomationRules(projectId),
    clearImportTab: importTab.clearImport,
    clearRuleTransients: automationTab.clearRuleTransients,
    setRuleProjectId: automationTab.setRuleProjectId,
  });

  return {
    githubTab: tabs.githubTab,
    tabRefs: tabs.tabRefs,
    selectGithubTab: tabs.selectGithubTab,
    handleOpenChange: (next: boolean) => {
      onOpenChange(next);
      if (!next) tabs.handleClose();
    },
    importTab,
    automationTab,
  };
}
