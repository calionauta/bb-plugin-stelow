import { useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

type FormValues = {
  ruleProjectId: string | null;
  automationLabels: string[];
  automationAuthorsInput: string;
  automationPromptInput: string;
  automationStart: boolean;
  setBusy: (busy: boolean) => void;
  reloadRules: (projectId: string) => Promise<void>;
};

export type AutomationRuleForm = {
  automationLabels: string[];
  setAutomationLabels: (labels: string[]) => void;
  automationAuthorsInput: string;
  setAutomationAuthorsInput: (value: string) => void;
  automationPromptInput: string;
  setAutomationPromptInput: (value: string) => void;
  automationStart: boolean;
  setAutomationStart: (value: boolean) => void;
  automationBusy: boolean;
  parseAutomationForm: () => string[];
  saveAutomationRule: () => Promise<void>;
};

/**
 * The save form, and the one rule about it: a save with no project or no label
 * is not an error the user caused, it is an incomplete form, so it does nothing
 * and says nothing rather than posting an empty rule.
 */
export function useAutomationRuleForm(
  rpc: Rpc,
  { ruleProjectId, reloadRules }: { ruleProjectId: string | null; reloadRules: (projectId: string) => Promise<void> },
): AutomationRuleForm {
  const [automationLabels, setAutomationLabels] = useState<string[]>(["stelow-work"]);
  const [automationAuthorsInput, setAutomationAuthorsInput] = useState("");
  const [automationPromptInput, setAutomationPromptInput] = useState("");
  const [automationStart, setAutomationStart] = useState(false);
  const [automationBusy, setAutomationBusy] = useState(false);
  const values: FormValues = {
    ruleProjectId, automationLabels, automationAuthorsInput, automationPromptInput,
    automationStart, setBusy: setAutomationBusy, reloadRules,
  };

  return {
    automationLabels, setAutomationLabels,
    automationAuthorsInput, setAutomationAuthorsInput,
    automationPromptInput, setAutomationPromptInput,
    automationStart, setAutomationStart,
    automationBusy,
    parseAutomationForm: () => automationLabels,
    saveAutomationRule: () => saveRule(rpc, values),
  };
}

export async function saveRule(rpc: Rpc, values: FormValues): Promise<void> {
  const labels = values.automationLabels;
  if (!values.ruleProjectId || labels.length === 0) return;
  const authors = values.automationAuthorsInput
    .split(",")
    .map((entry) => entry.trim().replace(/^@/, ""))
    .filter(Boolean);
  values.setBusy(true);
  try {
    const saved = await rpc.call("saveAutomationRule", {
      projectId: values.ruleProjectId,
      labels,
      trustedAuthors: authors,
      promptTemplate: values.automationPromptInput.trim(),
      enabled: true,
      startImmediate: values.automationStart,
    });
    await values.reloadRules(values.ruleProjectId);
    reportSave(saved.primed, values.automationStart);
  } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save automation rule."); }
  finally { values.setBusy(false); }
}

/** `primed` is the count already marked as seen: the rule starts from new ones. */
function reportSave(primed: number, automationStart: boolean): void {
  toast.success(primed > 0
    ? `Rule saved. ${primed} already-tagged issue${primed === 1 ? " is" : "s are"} marked as seen — only new ones will draft.`
    : automationStart
      ? "Rule saved. Matching issues start workers in isolated worktrees."
      : "Rule saved. Matching issues park as Bucket drafts.");
}
