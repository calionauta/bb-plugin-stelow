import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { GithubCandidate, GithubProject } from "./github-dialog-types";
import { useGithubImportQuery } from "./github-import-query";
import { useGithubImportSubmit } from "./github-import-submit";

/**
 * The import tab's state: the label query, the candidates it returns, which of
 * them the human picked, and the one action that moves them into the board. It
 * knows nothing about the automation tab, which is what lets both tabs change
 * without either one re-deriving what "the other tab" means.
 */
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
  clearImport: () => void;
};

export function useGithubImportTab({
  projects,
  onChanged,
  onOpenChange,
}: {
  projects: GithubProject[];
  onChanged: () => void;
  onOpenChange: (open: boolean) => void;
}): GithubImportTabState {
  const rpc = useRpc<typeof rpcContract>();
  const [importBusy, setImportBusy] = useState(false);
  const query = useGithubImportQuery(rpc, setImportBusy);
  const submit = useGithubImportSubmit(rpc, {
    visible: query.importVisible,
    selected: query.importSelected,
    labels: query.importLabels,
    setBusy: setImportBusy,
    onChanged,
    onOpenChange,
  });

  return {
    projects,
    importLabels: query.importLabels, setImportLabels: query.setImportLabels,
    importCandidates: query.importCandidates,
    importSelected: query.importSelected, setImportSelected: query.setImportSelected,
    importAllLabels: query.importAllLabels, importAllAssignees: query.importAllAssignees,
    importAssignee: query.importAssignee, setImportAssignee: query.setImportAssignee,
    importProject: query.importProject, setImportProject: query.setImportProject,
    importStart: submit.importStart, setImportStart: submit.setImportStart,
    importIsolated: submit.importIsolated, setImportIsolated: submit.setImportIsolated,
    importBusy, importVisible: query.importVisible,
    listGithubIssues: query.listGithubIssues,
    importSelectedIssues: submit.importSelectedIssues,
    clearImport: query.clearCandidates,
  };
}
