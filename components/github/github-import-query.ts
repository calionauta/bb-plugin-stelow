import { useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import { filterImportCandidates, preselectFreshIssues } from "../../lib/github-lists.mjs";
import type { GithubCandidate } from "./github-dialog-types";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

type ImportSinks = {
  importLabels: string[];
  clearCandidates: () => void;
  setImportCandidates: (issues: GithubCandidate[]) => void;
  setImportSelected: (selected: Record<string, boolean>) => void;
  setImportAllLabels: (labels: string[]) => void;
  setImportAllAssignees: (assignees: string[]) => void;
};

/**
 * The import query: the labels, the candidates they return, which of them the
 * human picked, and the client-side narrowing over the two filters. It never
 * mutates the board, so it takes no `onChanged` and no busy flag of its own —
 * the two belong to the submit half, which is the half that can fail.
 */
export type GithubImportQuery = {
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
  importVisible: GithubCandidate[];
  listGithubIssues: (explicit?: string[]) => Promise<void>;
  /** Called when the dialog closes, so a stale candidate list never survives it. */
  clearCandidates: () => void;
};

export function useGithubImportQuery(rpc: Rpc, setBusy: (busy: boolean) => void): GithubImportQuery {
  const [importLabels, setImportLabels] = useState<string[]>(["stelow-work"]);
  const [importCandidates, setImportCandidates] = useState<GithubCandidate[]>([]);
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importAllLabels, setImportAllLabels] = useState<string[]>([]);
  const [importAllAssignees, setImportAllAssignees] = useState<string[]>([]);
  const [importAssignee, setImportAssignee] = useState<string>("all");
  const [importProject, setImportProject] = useState<string>("all");

  const clearCandidates = (): void => {
    setImportCandidates([]);
    setImportSelected({});
  };
  const listGithubIssues = (explicit?: string[]): Promise<void> => listCandidates(rpc, setBusy, {
    importLabels, clearCandidates, setImportCandidates, setImportSelected, setImportAllLabels, setImportAllAssignees,
  }, explicit);
  // Client-side narrowing over the label-filtered candidates (lib,
  // tested: assignee/project picks, unmapped isolation, fail-soft).
  const importVisible = filterImportCandidates<GithubCandidate>(importCandidates, {
    assignee: importAssignee,
    project: importProject,
  });

  return {
    importLabels, setImportLabels,
    importCandidates,
    importSelected, setImportSelected,
    importAllLabels, importAllAssignees,
    importAssignee, setImportAssignee,
    importProject, setImportProject,
    importVisible, listGithubIssues, clearCandidates,
  };
}

/**
 * A query with no labels is not an error: it is a chip the human just removed.
 * Clearing the stale results is what makes that legible — leaving the previous
 * list on screen under an empty query would read as "these still match".
 */
export async function listCandidates(
  rpc: Rpc,
  setBusy: (busy: boolean) => void,
  sinks: ImportSinks,
  explicit?: string[],
): Promise<void> {
  const labels = (explicit ?? sinks.importLabels).map((entry) => entry.trim()).filter(Boolean);
  if (labels.length === 0) {
    sinks.clearCandidates();
    return;
  }
  setBusy(true);
  sinks.clearCandidates();
  try {
    const result = await rpc.call("listGithubCandidates", { labels });
    sinks.setImportCandidates(result.issues);
    sinks.setImportAllLabels(result.allLabels);
    sinks.setImportAllAssignees(result.allAssignees);
    // Preselect only issues not yet imported (lib, tested), so the flow is a
    // one-click "bring in everything tagged" rather than a long checklist.
    sinks.setImportSelected(preselectFreshIssues(result.issues));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Unable to list GitHub issues.");
  } finally {
    setBusy(false);
  }
}
