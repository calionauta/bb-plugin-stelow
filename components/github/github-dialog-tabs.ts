import { useEffect, useRef, useState } from "react";
import type { GithubProject, GithubTab } from "./github-dialog-types";

/**
 * The tab choreography — the one thing the two tabs genuinely share, and the
 * reason the dialog's state is a composition root rather than two independent
 * hooks. Switching a tab has to load that tab, drop the other tab's preview, and
 * (on a keyboard selection) move focus. Opening has to re-anchor the rule
 * project on every open rather than on mount, so a stale pick can never write a
 * rule to the wrong project. Keeping this here is what stops each tab from
 * having to know the other exists.
 */
export function useGithubTabChoreography({
  open,
  activeProjectId,
  projects,
  loadImportTab,
  loadAutomationTab,
  anchorAutomationTab,
  clearImportTab,
  clearRuleTransients,
  setRuleProjectId,
}: {
  open: boolean;
  activeProjectId: string | null;
  projects: GithubProject[];
  loadImportTab: () => void;
  /** The tab switch loads the automation tab for the project it is already on. */
  loadAutomationTab: () => void;
  /** The open re-anchors it, so it takes the project explicitly. */
  anchorAutomationTab: (projectId: string | null) => void;
  clearImportTab: () => void;
  clearRuleTransients: () => void;
  setRuleProjectId: (id: string | null) => void;
}) {
  const [githubTab, setGithubTab] = useState<GithubTab>("import");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function selectGithubTab(tab: GithubTab, focus = false): void {
    setGithubTab(tab);
    clearRuleTransients();
    if (tab === "import") loadImportTab();
    else loadAutomationTab();
    if (focus) tabRefs.current[tab]?.focus();
  }

  function handleClose(): void {
    clearImportTab();
    clearRuleTransients();
  }

  useEffect(() => {
    if (!open) return;
    const target = anchorAutomationProject(activeProjectId, projects);
    setRuleProjectId(target);
    if (githubTab === "import") loadImportTab();
    else anchorAutomationTab(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { githubTab, tabRefs, selectGithubTab, handleClose };
}

/**
 * Which project automation writes to when the dialog opens: the board's own
 * project, else the first one that exists, else nothing at all. It is a named
 * rule because "no board project" must mean "ask", never "write to whichever
 * project the list happens to show first".
 */
export function anchorAutomationProject(
  activeProjectId: string | null,
  projects: GithubProject[],
): string | null {
  return activeProjectId ?? projects[0]?.id ?? null;
}
