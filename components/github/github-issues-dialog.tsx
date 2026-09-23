import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GithubAutomationTab } from "./github-automation-tab";
import { GithubDialogFooter, GithubTabList } from "./github-dialog-chrome";
import { GithubImportTab } from "./github-import-tab";
import { useGithubDialogState, type GithubProject, type GithubStatus } from "./github-dialog-state";

// Dialog shell: frame + tablist + tab panels + footer. Tab state lives in
// the dialog hook; each tab owns its render. Type re-exports keep existing
// import sites stable.

export type { GithubProject, GithubStatus } from "./github-dialog-state";

export function GithubIssuesDialog({ open, onOpenChange, projects, activeProjectId, activeProjectName, githubStatus, onChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: GithubProject[];
  activeProjectId: string | null;
  activeProjectName: string | null;
  githubStatus: GithubStatus | null;
  onChanged: () => void;
}) {
  const { githubTab, tabRefs, selectGithubTab, handleOpenChange, importTab, automationTab } = useGithubDialogState({ projects, activeProjectId, onChanged, onOpenChange, open });
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>GitHub issues</DialogTitle>
          <DialogDescription>Bring tagged issues into Stelow as cards. Import now while you watch, or watch labels automatically per project.</DialogDescription>
        </DialogHeader>
        <GithubTabList tab={githubTab} onSelect={selectGithubTab} tabRefs={tabRefs} />
        <div role="tabpanel" id={`github-panel-${githubTab}`} aria-labelledby={`github-tab-${githubTab}`}>
        {githubTab === "import" ? (
          <GithubImportTab tab={importTab} githubStatus={githubStatus} />
        ) : (
          <GithubAutomationTab tab={automationTab} activeProjectName={activeProjectName} />
        )}
        </div>
        <GithubDialogFooter tab={githubTab} importTab={importTab} automationTab={automationTab} />
      </DialogContent>
    </Dialog>
  );
}
