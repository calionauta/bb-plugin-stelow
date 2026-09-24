import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import type { GithubAutomationTabState, GithubImportTabState } from "./github-dialog-state";

// Dialog chrome: the WAI-APG tablist (arrows move and select, roving
// tabindex — deliberately NOT the board's nav pattern) and the per-tab
// footer actions. The shell composes frame + chrome + tabs.

export function GithubTabList({ tab, onSelect, tabRefs }: {
  tab: "import" | "auto";
  onSelect: (tab: "import" | "auto", focus?: boolean) => void;
  tabRefs: React.RefObject<Record<string, HTMLButtonElement | null>>;
}) {
  // Tabs switch panels inside one dialog (WAI-APG tablist: arrows move and
  // select, roving tabindex). Deliberately NOT the board's nav pattern
  // (aria-current, routed views) nor the inbox pressed-filters — same
  // look, different contract.
  return (
    <div role="tablist" aria-label="GitHub sections" className="flex min-h-11 gap-1 rounded-md border p-1" onKeyDown={(event) => {
      const order = ["import", "auto"] as const;
      const at = order.indexOf(tab);
      if (event.key === "ArrowRight") { event.preventDefault(); onSelect(order[(at + 1) % order.length]!, true); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); onSelect(order[(at + order.length - 1) % order.length]!, true); }
      else if (event.key === "Home") { event.preventDefault(); onSelect(order[0]!, true); }
      else if (event.key === "End") { event.preventDefault(); onSelect(order[order.length - 1]!, true); }
    }}>
      {(["import", "auto"] as const).map((entry) => (
        <button
          key={entry}
          ref={(node) => { tabRefs.current[entry] = node; }}
          role="tab"
          id={`github-tab-${entry}`}
          aria-selected={tab === entry}
          aria-controls={`github-panel-${entry}`}
          tabIndex={tab === entry ? 0 : -1}
          onClick={() => onSelect(entry)}
          className={`inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded px-3 text-sm font-medium ${tab === entry ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}
        >{entry === "import" ? "Import now" : "Auto-import"}</button>
      ))}
    </div>
  );
}

export function GithubDialogFooter({ tab, importTab, automationTab }: {
  tab: "import" | "auto";
  importTab: GithubImportTabState;
  automationTab: GithubAutomationTabState;
}) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="ghost" disabled={importTab.importBusy || automationTab.automationBusy}>Cancel</Button>
      </DialogClose>
      {tab === "import"
        ? <Button onClick={() => void importTab.importSelectedIssues()} disabled={importTab.importBusy}>{importTab.importStart ? "Import and start" : "Park in Inbox"}</Button>
        : <Button disabled={automationTab.automationBusy || automationTab.automationLabels.length === 0 || !automationTab.ruleProjectId} title={automationTab.ruleProjectName ? `Save this rule on ${automationTab.ruleProjectName}` : undefined} onClick={() => void automationTab.saveAutomationRule()}>{automationTab.automationBusy ? "Saving…" : automationTab.ruleProjectName ? <>Add rule to <span className="max-w-40 truncate">{automationTab.ruleProjectName}</span></> : "Add rule"}</Button>}
    </DialogFooter>
  );
}
