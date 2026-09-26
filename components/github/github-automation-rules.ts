import { useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import type { AutomationRule, GithubProject } from "./github-dialog-types";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

type RuleSinks = {
  automationRules: AutomationRule[];
  setAutomationRules: React.Dispatch<React.SetStateAction<AutomationRule[]>>;
};

export type AutomationRuleList = {
  automationRules: AutomationRule[];
  ruleProjectId: string | null;
  setRuleProjectId: (id: string | null) => void;
  ruleProjectName: string | null;
  refreshAutomationRules: (projectId?: string | null) => Promise<void>;
  setAutomationRule: (rule: { id: string; enabled: boolean }, enabled: boolean) => Promise<void>;
  deleteAutomationRule: (ruleId: string) => Promise<void>;
};

/**
 * The rule list and the project it belongs to. Rules live on one project and the
 * board's active project is only the default — the picker lets automation cover
 * any project, including when the dialog opens from a board with none active, so
 * the target is a field here and not an assumption about which board is open.
 */
export function useAutomationRuleList(
  rpc: Rpc,
  projects: GithubProject[],
  activeProjectId: string | null,
): AutomationRuleList {
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [ruleProjectId, setRuleProjectId] = useState<string | null>(activeProjectId);
  const sinks: RuleSinks = { automationRules, setAutomationRules };
  // The save names its project, so carried-over labels can never silently
  // land a rule on the wrong one — the target reads on the button itself.
  const ruleProjectName = projects.find((project) => project.id === ruleProjectId)?.name ?? null;

  return {
    automationRules, ruleProjectId, setRuleProjectId, ruleProjectName,
    refreshAutomationRules: (projectId = ruleProjectId) => refreshRules(rpc, setAutomationRules, projectId),
    setAutomationRule: (rule, enabled) => toggleRule(rpc, sinks, rule.id, enabled),
    deleteAutomationRule: (ruleId) => deleteRule(rpc, setAutomationRules, ruleId),
  };
}

export async function refreshRules(
  rpc: Rpc,
  setAutomationRules: (rules: AutomationRule[]) => void,
  projectId: string | null,
): Promise<void> {
  if (!projectId) { setAutomationRules([]); return; }
  try {
    const result = await rpc.call("listAutomationRules", { projectId });
    setAutomationRules(result.rules);
  } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load automation rules."); }
}

/**
 * The toggle passes the whole rule back, not just the flag: a save that sends
 * only `enabled` would silently wipe the rule's labels, authors, template, and
 * start policy every time a human pauses it.
 */
export async function toggleRule(
  rpc: Rpc,
  sinks: RuleSinks,
  ruleId: string,
  enabled: boolean,
): Promise<void> {
  const current = sinks.automationRules.find((entry) => entry.id === ruleId);
  if (!current) return;
  try {
    const result = await rpc.call("saveAutomationRule", {
      id: current.id,
      projectId: current.projectId,
      labels: current.labels,
      trustedAuthors: current.trustedAuthors,
      promptTemplate: current.promptTemplate,
      enabled,
      startImmediate: current.startImmediate,
    });
    const replacement = result.rule;
    sinks.setAutomationRules((rules) => rules.map((entry) => entry.id === ruleId ? replacement : entry));
  } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update automation rule."); }
}

export async function deleteRule(
  rpc: Rpc,
  setAutomationRules: React.Dispatch<React.SetStateAction<AutomationRule[]>>,
  ruleId: string,
): Promise<void> {
  try {
    await rpc.call("deleteAutomationRule", { id: ruleId });
    setAutomationRules((rules) => rules.filter((entry) => entry.id !== ruleId));
  } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to delete automation rule."); }
}
