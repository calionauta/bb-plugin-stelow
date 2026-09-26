import { useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import type { RulePreview, RuleRunEntry } from "./github-dialog-types";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export type RuleTransients = {
  rulePreview: RulePreview | null;
  setRulePreview: (preview: RulePreview | null) => void;
  rulePreviewBusy: boolean;
  ruleRuns: Record<string, RuleRunEntry[]>;
  runsOpen: Record<string, boolean>;
  previewRule: (labels: string[], authors?: string[]) => Promise<void>;
  toggleRuleRuns: (ruleId: string) => Promise<void>;
  clearRuleTransients: () => void;
};

/**
 * The two read-only views a rule produces: what it would match, and what it did
 * match. Both are transients — neither survives a tab switch or a close, because
 * a preview shown next to a different project's rules is a lie and a run log
 * read after the rule changed is a different history.
 */
export function useRuleTransients(rpc: Rpc, ruleProjectId: string | null): RuleTransients {
  const [rulePreview, setRulePreview] = useState<RulePreview | null>(null);
  const [rulePreviewBusy, setRulePreviewBusy] = useState(false);
  const [ruleRuns, setRuleRuns] = useState<Record<string, RuleRunEntry[]>>({});
  const [runsOpen, setRunsOpen] = useState<Record<string, boolean>>({});

  function clearRuleTransients(): void {
    setRulePreview(null);
    setRuleRuns({});
    setRunsOpen({});
  }

  async function previewRule(labels: string[], authors: string[] = []): Promise<void> {
    if (!ruleProjectId || labels.length === 0) {
      toast.error("Pick a project and at least one label to preview.");
      return;
    }
    setRulePreviewBusy(true);
    try {
      const result = await rpc.call("previewAutomationRule", {
        projectId: ruleProjectId,
        labels,
        trustedAuthors: authors,
      });
      setRulePreview({ labels, matches: result.matches, skipped: result.skipped });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to preview rule matches."); }
    finally { setRulePreviewBusy(false); }
  }

  async function toggleRuleRuns(ruleId: string): Promise<void> {
    const open = !runsOpen[ruleId];
    setRunsOpen((prev) => ({ ...prev, [ruleId]: open }));
    if (open && !ruleRuns[ruleId]) {
      try {
        const result = await rpc.call("listAutomationRuleRuns", { ruleId, limit: 20 });
        setRuleRuns((prev) => ({ ...prev, [ruleId]: result.runs }));
      } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load rule runs."); }
    }
  }

  return {
    rulePreview, setRulePreview, rulePreviewBusy,
    ruleRuns, runsOpen, previewRule, toggleRuleRuns, clearRuleTransients,
  };
}
