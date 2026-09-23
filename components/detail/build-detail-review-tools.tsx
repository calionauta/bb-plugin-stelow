import { shouldShowBuildDiff } from "../../lib/build-diff-presentation.mjs";
import type { BuildDetailView } from "./build-detail-body";
import { BuildDiff } from "./build-diff";
import { BuildPublication } from "./build-publication";
import { WorkspaceRecoveryPanel } from "./build-recovery";

export function BuildReviewTools({
  cardId,
  view,
}: {
  cardId: string;
  view: BuildDetailView;
}) {
  const { card, detail, lifecycle } = view;
  if (!card) return null;
  const recovery = lifecycle.workspaceRecovery;
  return (
    <>
      {shouldShowBuildDiff({
        status: card.status,
        stage: card.stage,
        publicationDirty: view.publicationDirty,
        recoveryKind: recovery?.kind ?? null,
      })
        ? (
          <BuildDiff
            cardId={cardId}
            workspaceKind={card.workspaceKind}
            fileEnvironmentId={detail?.fileEnvironmentId ?? null}
            onOpenFile={view.setViewerFile}
          />
        )
        : null}
      {card.status === "completed"
        ? (
          <BuildPublication
            cardId={cardId}
            verifiedHeadSha={detail?.card.verifiedHeadSha ?? null}
            recoveryContent={card.workspaceKind === "exploratory"
              ? <BuildRecoveryContent card={card} lifecycle={lifecycle} view={view} />
              : null}
            onChanged={view.load}
            onDirtyChange={view.setPublicationDirty}
            onBranchChange={view.setPublicationBranch}
          />
        )
        : null}
    </>
  );
}

type BuildRecoveryContentProps = {
  card: NonNullable<BuildDetailView["card"]>;
  lifecycle: BuildDetailView["lifecycle"];
  view: BuildDetailView;
};

function BuildRecoveryContent({ card, lifecycle, view }: BuildRecoveryContentProps) {
  return (
    <WorkspaceRecoveryPanel
      recovery={lifecycle.workspaceRecovery}
      loading={lifecycle.workspaceRecoveryLoading || lifecycle.creatingRecoveryAudit}
      onRefresh={() => void lifecycle.loadWorkspaceRecovery()}
      onPromote={() => {
        lifecycle.setPromoteName(card.displayName);
        lifecycle.setPromoteOpen(true);
      }}
      onAttach={lifecycle.setRecoveryAttachProjectId}
      onCreateAudit={() => void lifecycle.doCreateRecoveryAudit()}
      onOpenAudit={view.onOpenRecoveryAudit}
    />
  );
}
