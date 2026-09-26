import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { GithubProject } from "./github-dialog-types";
import { useAutomationRuleForm } from "./github-automation-form";
import { useAutomationRuleList } from "./github-automation-rules";
import { useRuleTransients } from "./github-automation-transients";

/**
 * The automation tab's state, composed from the three things a rule actually is:
 * the list and the project it belongs to, the form that saves one, and the two
 * read-only views it produces. Each is a hook of its own because each fails
 * differently — a list that will not load, a save that will not land, a preview
 * that will not render — and one hook per failure is one hook per fix.
 */
export type GithubAutomationTabState = {
  projects: GithubProject[];
  automationRules: ReturnType<typeof useAutomationRuleList>["automationRules"];
  automationLabels: string[];
  setAutomationLabels: (labels: string[]) => void;
  automationAuthorsInput: string;
  setAutomationAuthorsInput: (value: string) => void;
  automationPromptInput: string;
  setAutomationPromptInput: (value: string) => void;
  automationStart: boolean;
  setAutomationStart: (value: boolean) => void;
  automationBusy: boolean;
  rulePreview: ReturnType<typeof useRuleTransients>["rulePreview"];
  setRulePreview: (preview: ReturnType<typeof useRuleTransients>["rulePreview"]) => void;
  rulePreviewBusy: boolean;
  ruleRuns: ReturnType<typeof useRuleTransients>["ruleRuns"];
  runsOpen: ReturnType<typeof useRuleTransients>["runsOpen"];
  ruleProjectId: string | null;
  setRuleProjectId: (id: string | null) => void;
  ruleProjectName: string | null;
  importAllLabels: string[];
  refreshAutomationRules: (projectId?: string | null) => Promise<void>;
  parseAutomationForm: () => string[];
  saveAutomationRule: () => Promise<void>;
  setAutomationRule: ReturnType<typeof useAutomationRuleList>["setAutomationRule"];
  previewRule: ReturnType<typeof useRuleTransients>["previewRule"];
  toggleRuleRuns: ReturnType<typeof useRuleTransients>["toggleRuleRuns"];
  deleteAutomationRule: ReturnType<typeof useAutomationRuleList>["deleteAutomationRule"];
  clearRuleTransients: () => void;
};

export function useGithubAutomationTab({
  projects,
  activeProjectId,
  importAllLabels,
}: {
  projects: GithubProject[];
  activeProjectId: string | null;
  importAllLabels: string[];
}): GithubAutomationTabState {
  const rpc = useRpc<typeof rpcContract>();
  const list = useAutomationRuleList(rpc, projects, activeProjectId);
  const form = useAutomationRuleForm(rpc, {
    ruleProjectId: list.ruleProjectId,
    reloadRules: list.refreshAutomationRules,
  });
  const transients = useRuleTransients(rpc, list.ruleProjectId);

  return {
    projects,
    automationRules: list.automationRules,
    automationLabels: form.automationLabels, setAutomationLabels: form.setAutomationLabels,
    automationAuthorsInput: form.automationAuthorsInput,
    setAutomationAuthorsInput: form.setAutomationAuthorsInput,
    automationPromptInput: form.automationPromptInput,
    setAutomationPromptInput: form.setAutomationPromptInput,
    automationStart: form.automationStart, setAutomationStart: form.setAutomationStart,
    automationBusy: form.automationBusy,
    rulePreview: transients.rulePreview, setRulePreview: transients.setRulePreview,
    rulePreviewBusy: transients.rulePreviewBusy,
    ruleRuns: transients.ruleRuns, runsOpen: transients.runsOpen,
    ruleProjectId: list.ruleProjectId, setRuleProjectId: list.setRuleProjectId,
    ruleProjectName: list.ruleProjectName,
    importAllLabels,
    refreshAutomationRules: list.refreshAutomationRules,
    parseAutomationForm: form.parseAutomationForm,
    saveAutomationRule: form.saveAutomationRule,
    setAutomationRule: list.setAutomationRule,
    previewRule: transients.previewRule,
    toggleRuleRuns: transients.toggleRuleRuns,
    deleteAutomationRule: list.deleteAutomationRule,
    clearRuleTransients: transients.clearRuleTransients,
  };
}
