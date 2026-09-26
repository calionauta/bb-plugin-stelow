import { useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import type { GithubCandidate } from "./github-dialog-types";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export type GithubImportSubmit = {
  importStart: boolean;
  setImportStart: (value: boolean) => void;
  importIsolated: boolean;
  setImportIsolated: (value: boolean) => void;
  importSelectedIssues: () => Promise<void>;
};

/**
 * The import submit: the one action in the tab that moves anything. It is kept
 * apart from the query because it owns the two irreversible choices (start now,
 * start isolated) and because one issue failing must not cost the human the
 * rest of the batch.
 */
export function useGithubImportSubmit(
  rpc: Rpc,
  {
    visible,
    selected,
    labels,
    setBusy,
    onChanged,
    onOpenChange,
  }: {
    visible: GithubCandidate[];
    selected: Record<string, boolean>;
    labels: string[];
    setBusy: (busy: boolean) => void;
    onChanged: () => void;
    onOpenChange: (open: boolean) => void;
  },
): GithubImportSubmit {
  const [importStart, setImportStart] = useState(false);
  const [importIsolated, setImportIsolated] = useState(false);

  async function importSelectedIssues(): Promise<void> {
    const chosen = visible.filter((issue) => selected[`${issue.repo}#${issue.number}`]);
    if (chosen.length === 0) {
      toast.error("No issues selected.");
      return;
    }
    const query = labels.map((entry) => entry.trim()).filter(Boolean);
    setBusy(true);
    const imported = await importEach(rpc, chosen, query, importStart, importIsolated);
    setBusy(false);
    onOpenChange(false);
    reportImport(imported, importStart, importIsolated, onChanged);
  }

  return { importStart, setImportStart, importIsolated, setImportIsolated, importSelectedIssues };
}

/**
 * The server resolves each issue's owning project from its repo; no per-issue
 * picker needed, and intent is derived server-side.
 */
export async function importEach(
  rpc: Rpc,
  chosen: GithubCandidate[],
  labels: string[],
  importStart: boolean,
  importIsolated: boolean,
): Promise<{ imported: number; inFlight: number }> {
  let imported = 0;
  let inFlight = 0;
  for (const issue of chosen) {
    try {
      const result = await rpc.call("importGithubIssue", {
        repo: issue.repo,
        number: issue.number,
        labels,
        start: importStart,
        isolated: importIsolated,
      });
      if (result.ok && !result.skipped) imported += 1;
      else if (result.skipped === "in-flight") inFlight += 1;
    } catch (error) {
      toast.error(`Issue ${issue.repo}#${issue.number}: ${error instanceof Error ? error.message : "import failed"}`);
    }
  }
  return { imported, inFlight };
}

function reportImport(
  result: { imported: number; inFlight: number },
  importStart: boolean,
  importIsolated: boolean,
  onChanged: () => void,
): void {
  const count = result.imported;
  if (count > 0) {
    const noun = `issue${count === 1 ? "" : "s"}`;
    toast.success(importStart
      ? `Imported and started ${count} ${noun}${importIsolated ? " in isolated worktrees" : ""}.`
      : `Parked ${count} ${noun} in Inbox.`);
    onChanged();
  }
  if (result.inFlight > 0) {
    const noun = result.inFlight === 1 ? "it" : "them";
    toast.success(`${result.inFlight} already being imported — refresh to see ${noun}.`);
  }
}
