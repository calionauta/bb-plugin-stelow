import { archivedCardDetailPresentation } from "../../lib/card-detail-presentation.mjs";
import { artifactRoleCounts } from "../../lib/artifact-roles.mjs";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";
import {
  ArtifactGroups,
  AuditTrailStatusRow,
  artifactGroupTitle,
} from "../artifacts/artifact-inventory";
import { DisclosureSection, startsOpen } from "../disclosure";
import type { BuildDetailView } from "./build-detail-view";
import { BuildProgress } from "./build-progress";
import { heroFor } from "./detail-hero";

export function BuildProgressSection({ view }: { view: BuildDetailView }) {
  const { card, detail } = view;
  if (!card) return null;
  const hero = heroFor(card, detail);
  // The count reads the same rule the inventory applies, rather than a second
  // copy of the filter: when the two disagreed, the section said "4 files" over
  // three rows.
  const { deliverables } = artifactRoleCounts(detail?.artifacts ?? []);
  const artifactTotal = deliverables;
  return detail
    ? (
      <BuildProgress
        card={card}
        detail={detail}
        archivedPresentation={archivedCardDetailPresentation(card, stageLabel)}
        artifactTotal={artifactTotal}
        defaultOpen={startsOpen({ live: hero?.kind === "working", blocking: hero?.kind === "calm" })}
        onOpenArtifacts={view.showArtifacts}
        onViewFile={view.setViewerFile}
      />
    )
    : <p className="text-xs text-muted-foreground">Loading…</p>;
}

export function BuildArtifacts({ view }: { view: BuildDetailView }) {
  const { card, detail } = view;
  if (!card) return null;
  const { deliverables, evidence } = artifactRoleCounts(detail?.artifacts ?? []);
  return (
    <div ref={view.artifactsRef}>
      <DisclosureSection
        title="Artifacts"
        hint={artifactHint(detail, deliverables, evidence)}
        open={view.artifactsOpen}
        onToggle={view.setArtifactsOpen}
      >
        {card.status === "completed" ? <AuditTrailStatusRow cardId={card.id} /> : null}
        {detail
          ? (
            <ArtifactGroups
              artifacts={detail.artifacts}
              workspaceKind={card.workspaceKind}
              fileEnvironmentId={detail.fileEnvironmentId}
              onView={view.setViewerFile}
              groupTitleForStage={artifactGroupTitle}
            />
          )
          : <p className="text-xs text-muted-foreground">Loading…</p>}
      </DisclosureSection>
    </div>
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
