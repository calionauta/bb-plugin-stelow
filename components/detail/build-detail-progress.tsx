import { archivedCardDetailPresentation } from "../../lib/card-detail-presentation.mjs";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";
import {
  ArtifactGroups,
  AuditTrailStatusRow,
  artifactGroupTitle,
} from "../artifacts/artifact-inventory";
import { DisclosureSection } from "../disclosure";
import type { BuildDetailView } from "./build-detail-view";
import { BuildProgress } from "./build-progress";
import { heroFor } from "./detail-hero";

type BuildCard = NonNullable<BuildDetailView["card"]>;
type BuildDetail = NonNullable<BuildDetailView["detail"]>;

export function BuildProgressSection({ view }: { view: BuildDetailView }) {
  const { card, detail } = view;
  if (!card) return null;
  const hero = heroFor(card, detail);
  const artifactTotal = detail?.artifacts.filter(
    (artifact) => artifact.role !== "evidence",
  ).length ?? 0;
  return detail
    ? (
      <BuildProgress
        card={card}
        detail={detail}
        archivedPresentation={archivedCardDetailPresentation(card, stageLabel)}
        artifactTotal={artifactTotal}
        defaultOpen={hero?.kind === "working" || hero?.kind === "calm"}
        intentLabels={view.intentLabels}
        onOpenArtifacts={view.showArtifacts}
        onPickStage={view.setPendingAdvance}
        onViewFile={view.setViewerFile}
      />
    )
    : <p className="text-xs text-muted-foreground">Loading…</p>;
}

export function BuildArtifacts({ view }: { view: BuildDetailView }) {
  const { card, detail } = view;
  if (!card) return null;
  const deliverables = detail?.artifacts.filter(
    (artifact) => artifact.role !== "evidence",
  ) ?? [];
  const evidence = detail?.artifacts.filter(
    (artifact) => artifact.role === "evidence",
  ) ?? [];
  return (
    <div ref={view.artifactsRef}>
      <DisclosureSection
        title="Artifacts"
        hint={artifactHint(detail, deliverables.length, evidence.length)}
        open={view.artifactsOpen}
        onToggle={view.setArtifactsOpen}
      >
        {card.status === "completed" ? <AuditTrailStatusRow cardId={card.id} /> : null}
        {detail
          ? (
            <ArtifactLists
              card={card}
              detail={detail}
              deliverables={deliverables}
              evidence={evidence}
              view={view}
            />
          )
          : <p className="text-xs text-muted-foreground">Loading…</p>}
      </DisclosureSection>
    </div>
  );
}

function ArtifactLists({
  card,
  detail,
  deliverables,
  evidence,
  view,
}: {
  card: BuildCard;
  detail: BuildDetail;
  deliverables: NonNullable<BuildDetail["artifacts"]>;
  evidence: NonNullable<BuildDetail["artifacts"]>;
  view: BuildDetailView;
}) {
  return (
    <>
      <ArtifactGroups
        artifacts={deliverables}
        workspaceKind={card.workspaceKind}
        fileEnvironmentId={detail.fileEnvironmentId}
        onView={view.setViewerFile}
        groupTitleForStage={artifactGroupTitle}
      />
      {evidence.length > 0
        ? (
          <section aria-label="Evidence" className="space-y-2 border-t pt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Evidence — machine receipts ({evidence.length})
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Kept for audit with the run bundle, not counted as deliverables.
            </p>
            <ArtifactGroups
              artifacts={evidence}
              workspaceKind={card.workspaceKind}
              fileEnvironmentId={detail.fileEnvironmentId}
              onView={view.setViewerFile}
              groupTitleForStage={artifactGroupTitle}
            />
          </section>
        )
        : null}
    </>
  );
}

function artifactHint(
  detail: BuildDetailView["detail"],
  deliverables: number,
  evidence: number,
) {
  if (!detail) return "produced files";
  const unregistered = detail.artifacts.some(
    (artifact) => artifact.stage === "unregistered",
  );
  return [
    `${deliverables} file${deliverables === 1 ? "" : "s"}`,
    evidence > 0 ? ` + ${evidence} evidence` : "",
    " · audit trail",
    unregistered ? " · some unregistered" : "",
  ].join("");
}
