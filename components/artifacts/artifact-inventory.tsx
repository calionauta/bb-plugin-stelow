import { useCallback, useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";
import { groupArtifactsByStage } from "../../lib/artifact-groups.mjs";

// Artifact surfaces: the file-target convention (workspace vs host links),
// the shared inventory renderer (every track supplies its grouping axis),
// the stage adapter, and the audit-trail freshness row. Rows always mean
// an actual file that opens in the viewer.

export type WorkspaceFileTarget = { kind: "workspace"; environmentId: string; path: string };
export type HostFileTarget = { kind: "host"; hostId: string; path: string };

// Workspace-kind links open in bb's official file viewer (with comments).
// Host-kind links cannot resolve exploratory paths, which live outside
// provisioned environments — so exploratory cards use the worker thread's
// environment + worktree-relative path, everything else keeps host links.
export function fileLinkTarget(useWorkspace: boolean, environmentId: string | null, relPath: string | null, hostId: string, absolutePath: string): WorkspaceFileTarget | HostFileTarget {
  if (useWorkspace && environmentId && relPath) return { kind: "workspace", environmentId, path: relPath };
  return { kind: "host", hostId, path: absolutePath };
}

type ArtifactInventoryFile = { kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string; note?: string | null };
export type ArtifactInventoryGroup = { id: string; title: string; items: ArtifactInventoryFile[] };

// A document the workflow wrote but never registered still belongs on the
// audit trail — it just says so instead of claiming a stage it cannot prove.
export function artifactGroupTitle(stage: string): string {
  return stage === "unregistered" ? "Produced but not registered" : stageLabel(stage);
}

export function artifactFilename(path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.split("/").pop() || path;
}

function formatArtifactDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

// One visual inventory for every card type. Each track supplies its durable
// grouping axis (Build stage, Research round, Explore technique); rows always mean
// an actual file that opens in the viewer.
export function ArtifactInventory({ groups, workspaceKind, fileEnvironmentId, onView }: {
  groups: ArtifactInventoryGroup[];
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onView: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null }) => void;
}) {
  if (groups.length === 0) return <p className="text-xs text-muted-foreground">No artifacts yet — they appear here as work completes.</p>;
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.id} className="space-y-1 rounded-md p-1">
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <p>{group.title}</p>
            <span className="shrink-0 normal-case tracking-normal">{group.items.length} artifact{group.items.length === 1 ? "" : "s"}</span>
          </div>
          <div className="divide-y divide-border rounded-md border">
            {group.items.map((file) => (
              <button
                key={file.path}
                onClick={() => onView({ display: file.display, path: file.absolutePath, target: fileLinkTarget(workspaceKind === "exploratory", fileEnvironmentId, file.path, file.hostId, file.absolutePath) })}
                className="flex min-h-11 w-full cursor-pointer items-start gap-2 px-2 py-2 text-left text-xs hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                title={`Open ${file.display} (${file.path})`}
              >
                <span className="mt-0.5" aria-hidden>📄</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{file.display}</span>
                  <span className="block truncate text-muted-foreground">{[formatArtifactDate(file.generatedAt), `File: ${artifactFilename(file.path)}`].filter(Boolean).join(" · ")}</span>
                  {file.note ? <span className="mt-0.5 block text-muted-foreground">{file.note}</span> : null}
                </span>
                <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>↗</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Build and Explore use stages as their canonical grouping axis. Keeping this
// adapter preserves the shared inventory while avoiding a second renderer.
export function ArtifactGroups({ artifacts, workspaceKind, fileEnvironmentId, onView, groupTitleForStage }: {
  artifacts: Array<{ stage: string; kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string }>;
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onView: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null }) => void;
  groupTitleForStage?: (stage: string) => string;
}) {
  const groups = useMemo<ArtifactInventoryGroup[]>(() => groupArtifactsByStage(artifacts).map((group) => ({
    id: group.stage,
    title: groupTitleForStage?.(group.stage) ?? stageLabel(group.stage),
    items: group.items,
  })), [artifacts, groupTitleForStage]);
  return <ArtifactInventory groups={groups} workspaceKind={workspaceKind} fileEnvironmentId={fileEnvironmentId} onView={onView} />;
}

// A completed Build card carries two receipts whose names differ by one word,
// so only their freshness tells them apart — and only Stelow can say that.
// This asks the helper on demand (never on every board read: `check` re-derives
// the projection and samples the worktree) and re-asks on the button, so a card
// whose tree moved after completion says so instead of reading as verified
// forever.
type AuditTrailStatus = {
  state: "verified" | "changed" | "missing" | "refused" | "unsupported" | "unavailable";
  detail: string | null; head: string | null; path: string | null; contract: string | null;
  recon: { state: "recorded" | "missing" | "invalid"; detail: string } | null;
};

const AUDIT_TRAIL_COPY: Record<AuditTrailStatus["state"], { label: string; tone: string; sub: string | null }> = {
  verified: { label: "Audit trail verified", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", sub: null },
  changed: { label: "Changed since completion", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", sub: "The repository or the workflow documents moved after this card was audited, so its receipt no longer describes the current tree. Re-check after committing, or re-run the audit." },
  missing: { label: "No audit trail", tone: "bg-muted text-muted-foreground", sub: "This card has no portable Stelow receipt. Cards completed before the receipt existed read this way." },
  refused: { label: "Audit trail refused", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", sub: null },
  unsupported: { label: "Audit trail unreadable", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", sub: null },
  unavailable: { label: "Audit trail unavailable", tone: "bg-muted text-muted-foreground", sub: null },
};

export function AuditTrailStatusRow({ cardId }: { cardId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<AuditTrailStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await rpc.call("auditTrailStatus", { cardId }));
    } catch {
      setStatus({ state: "unavailable", detail: "The host could not read the audit trail.", head: null, path: null, contract: null, recon: null });
    } finally {
      setChecking(false);
    }
  }, [cardId, rpc]);
  useEffect(() => { void check(); }, [check]);
  if (!status) return <p className="text-xs text-muted-foreground">Checking the audit trail…</p>;
  const copy = AUDIT_TRAIL_COPY[status.state];
  const detail = copy.sub ?? (status.state === "verified" ? (status.head ? `Attests HEAD ${status.head.slice(0, 12)}.` : null) : status.detail);
  return (
    <div className="mb-3 rounded-md border p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 font-medium ${copy.tone}`}>{copy.label}</span>
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="min-h-11 cursor-pointer rounded-md px-2 text-xs font-medium text-primary hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-60"
        >
          {checking ? "Checking…" : "Re-check"}
        </button>
      </div>
      {detail ? <p className="mt-1 text-muted-foreground">{detail}</p> : null}
      {status.recon && status.recon.state !== "recorded" ? (
        <p className="mt-1 text-amber-700 dark:text-amber-300">
          {status.recon.state === "missing"
            ? "No codebase context snapshot — advisory only, not a failure: the audit above still verified the tree. Run the recon preflight before the next audit to attach codebase context; cards completed before the receipt existed always read this way."
            : `Codebase context snapshot unreadable (${status.recon.detail}) — advisory only, not a failure: the audit above still verified the tree. Re-run the recon preflight, then re-run audit to refresh it.`}
        </p>
      ) : null}
    </div>
  );
}
