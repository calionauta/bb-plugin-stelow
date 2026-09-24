import { Button } from "@/components/ui/button";

type WorkspaceRecoveryCandidate = {
  projectId: string;
  projectName: string;
  path: string;
  branch: string | null;
  headSha: string | null;
  changedFiles: number;
  evidence: string;
};

type WorkspaceRecoveryData = {
  kind: "attached" | "promote" | "external-project" | "ambiguous" | "documents-only";
  message: string;
  candidates: WorkspaceRecoveryCandidate[];
  looseEvidence: Array<{ path: string; kind: "folder" | "patch" }>;
  recovery: {
    projectId: string;
    projectName: string;
    path: string;
    attachedAt: number;
  } | null;
  audit: { cardId: string; cardName: string; createdAt: number } | null;
};

type WorkspaceRecoveryPanelProps = {
  recovery: WorkspaceRecoveryData | null;
  loading: boolean;
  onRefresh: () => void;
  onPromote: () => void;
  onAttach: (projectId: string) => void;
  onCreateAudit: () => void;
  onOpenAudit: (cardId: string) => void;
};

function RecoveryHeader({ loading, onRefresh }: Pick<WorkspaceRecoveryPanelProps, "loading" | "onRefresh">) {
  const refreshLabel = loading ? "Checking…" : "Re-check evidence";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-medium">Workspace recovery</p>
      <Button
        size="sm"
        variant="outline"
        disabled={loading}
        onClick={onRefresh}
      >
        {refreshLabel}
      </Button>
    </div>
  );
}

function RecoveryCandidateCard({
  candidate,
  onAttach,
}: {
  candidate: WorkspaceRecoveryCandidate;
  onAttach: (projectId: string) => void;
}) {
  return (
    <div
      className="rounded border border-amber-500/20 bg-background/60 p-2 text-foreground"
    >
      <p className="font-medium">
        {candidate.projectName} · <code>{candidate.branch ?? "detached"}</code>
      </p>
      <p className="mt-1 break-all text-muted-foreground">
        <code>{candidate.path}</code> · {candidate.changedFiles} changed files · HEAD{" "}
        {candidate.headSha?.slice(0, 12) ?? "unknown"}
      </p>
      <p className="mt-1 text-muted-foreground">{candidate.evidence}</p>
      <Button
        className="mt-2"
        size="sm"
        variant="outline"
        onClick={() => onAttach(candidate.projectId)}
        title="Records this reviewed checkout on the card. It does not change the checkout or Git."
      >
        Attach for audit trail…
      </Button>
    </div>
  );
}

function RecoveryCandidates({
  recovery,
  onAttach,
}: {
  recovery: WorkspaceRecoveryData;
  onAttach: (projectId: string) => void;
}) {
  if (recovery.candidates.length === 0) return null;
  const introduction = recovery.kind === "promote"
    ? "This workspace also has a checkout the worker reported writing to. If the real work lives there instead, review and attach it below."
    : "Only registered BB projects on the same host, explicitly named by the worker, are offered.";

  return (
    <div className="space-y-2 border-t border-amber-500/20 pt-2">
      <p className="text-amber-900/80 dark:text-amber-100/80">
        {introduction} Attaching records provenance; it never moves files, stages changes, commits, or pushes.
      </p>
      {recovery.candidates.map((candidate) => (
        <RecoveryCandidateCard
          key={`${candidate.projectId}-${candidate.path}`}
          candidate={candidate}
          onAttach={onAttach}
        />
      ))}
    </div>
  );
}

function LooseRecoveryEvidence({ entries }: { entries: WorkspaceRecoveryData["looseEvidence"] }) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1 border-t border-amber-500/20 pt-2">
      <p className="text-amber-900/80 dark:text-amber-100/80">
        Reported loose evidence is preserved but never auto-applied: choose and review its destination in a recovery audit first.
      </p>
      {entries.map((entry) => (
        <p key={entry.path} className="break-all text-muted-foreground">
          <code>{entry.path}</code> · {entry.kind === "patch" ? "patch/bundle" : "folder"}
        </p>
      ))}
    </div>
  );
}

function AttachedRecovery({
  recovery,
  onCreateAudit,
  onOpenAudit,
}: {
  recovery: WorkspaceRecoveryData;
  onCreateAudit: () => void;
  onOpenAudit: (cardId: string) => void;
}) {
  if (recovery.kind !== "attached" || !recovery.recovery) return null;
  const attachment = recovery.recovery;
  return (
    <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2">
      <p className="font-medium">Attached: {attachment.projectName}</p>
      <p className="mt-1 break-all text-emerald-900/80 dark:text-emerald-100/80">
        <code>{attachment.path}</code> · attached {new Date(attachment.attachedAt).toLocaleString()}
      </p>
      <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">
        This original card is preserved as a mismatch record. A separate Build recovery audit owns review, tests, commits, and PRs.
      </p>
      {recovery.audit ? (
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={() => onOpenAudit(recovery.audit!.cardId)}
        >
          Open recovery audit
        </Button>
      ) : (
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={onCreateAudit}
        >
          Create recovery audit
        </Button>
      )}
    </div>
  );
}

function RecoveryMessage({
  recovery,
  onPromote,
}: {
  recovery: WorkspaceRecoveryData;
  onPromote: () => void;
}) {
  return (
    <>
      <p>{recovery.message}</p>
      {recovery.kind === "documents-only" ? (
        <p className="text-amber-900/80 dark:text-amber-100/80">
          Artifacts remain readable, but there is no verified code checkout to recover. New Build cards now require a project workspace.
        </p>
      ) : null}
      {recovery.kind === "promote" ? (
        <Button size="sm" variant="outline" onClick={onPromote}>
          Turn this source workspace into a project…
        </Button>
      ) : null}
    </>
  );
}

export function WorkspaceRecoveryPanel({
  recovery,
  loading,
  onRefresh,
  onPromote,
  onAttach,
  onCreateAudit,
  onOpenAudit,
}: WorkspaceRecoveryPanelProps) {
  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-100">
      <RecoveryHeader loading={loading} onRefresh={onRefresh} />
      {!recovery && !loading ? (
        <p>
          Checking whether this exploratory card has source material or a worker-reported registered checkout…
        </p>
      ) : null}
      {recovery ? (
        <>
          <RecoveryMessage recovery={recovery} onPromote={onPromote} />
          <RecoveryCandidates recovery={recovery} onAttach={onAttach} />
          <LooseRecoveryEvidence entries={recovery.looseEvidence} />
          <AttachedRecovery
            recovery={recovery}
            onCreateAudit={onCreateAudit}
            onOpenAudit={onOpenAudit}
          />
        </>
      ) : null}
    </div>
  );
}
