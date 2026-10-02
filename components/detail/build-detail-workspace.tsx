import { STAGE_TO_BAND, stageLabel } from "../../lib/workflow-vocabulary.mjs";
import { checkoutNoteFor, WorkerSection } from "../worker-history/worker-history";
import { LinkedDiscussionSection } from "../github/github-linked-discussion";
import type { BuildDetailView } from "./build-detail-view";
import { InputFiles } from "./input-files";
import { PreviewSection } from "./preview-section";
import { BAND_LABEL } from "./stage-timeline";

type BuildCard = NonNullable<BuildDetailView["card"]>;
type BuildDetail = NonNullable<BuildDetailView["detail"]>;

type BuildWorkspaceProps = {
  view: BuildDetailView;
  presetStale: boolean;
};

export function BuildWorkspace({ view, presetStale }: BuildWorkspaceProps) {
  const { card, detail, lifecycle } = view;
  if (!card) return null;
  const completedPreset = card.status === "completed"
    ? detail?.workerHistory.find((worker) => worker.threadId === card.workerThreadId)?.presetName ??
      detail?.card.presetName ?? "Default"
    : null;
  return (
    <>
      <WorkerSection
        card={card}
        detail={detail}
        presetStale={presetStale}
        restarting={lifecycle.restarting}
        onRestartWorker={() => lifecycle.setRestartWorkerOpen(true)}
        onPreset={() => view.setPresetDialogOpen(true)}
        presetPill={presetPill(card, detail, completedPreset)}
        presetNote={presetNote(card, detail)}
        pillTitle={presetPillTitle(card)}
        githubLink={detail?.githubLink
          ? <GithubStatus card={card} detail={detail} open={() => view.setGithubPostOpen(true)} openDraft={() => view.setGithubDraftOpen(true)} />
          : null}
        checkoutNote={checkoutNoteFor(detail?.card.environmentLabel, view.publicationBranch)}
      />
      <LinkedDiscussionSection cardId={card.id} />
      <InputFiles card={card} detail={detail} onView={view.setViewerFile} />
      <PreviewSection cardId={card.id} />
    </>
  );
}

function presetPill(
  card: BuildCard,
  detail: BuildDetailView["detail"],
  completedPreset: string | null,
) {
  if (card.status === "completed") return <>Completed · {completedPreset}</>;
  const band = BAND_LABEL[STAGE_TO_BAND[card.stage] ?? "analysis"];
  return <>{card.stage ? `${band} · ` : ""}{detail?.card.presetName ?? "default"}</>;
}

function presetNote(card: BuildCard, detail: BuildDetailView["detail"]) {
  if (card.status === "completed") return <>Preset recorded for the completed worker.</>;
  return (
    <>
      {card.stage ? <strong>{stageLabel(card.stage)}</strong> : "current"} phase
      {detail?.card.presetOverridden
        ? " — overridden for this card"
        : " — board default"} · applies to the next worker
    </>
  );
}

function presetPillTitle(card: BuildCard) {
  if (card.status === "completed") return "Preset used by the completed worker";
  return card.stage ? `Preset for the ${stageLabel(card.stage)} phase` : "Preset for the next worker";
}

/**
 * The completion summary's GitHub actions — and nothing else about GitHub.
 *
 * This used to also state which issue the card was linked to, inside the
 * worker section, while the mirror a few components down named the link
 * without ever naming the issue. Two components, two scroll positions, one
 * fact stated once and the other not at all. The linked issue's identity now
 * belongs to `LinkedDiscussionSection`, which owns GitHub linkage; what stays
 * here is the card-specific part — whether a summary has already been posted,
 * and the door to post or draft one.
 */
function GithubStatus({
  card,
  detail,
  open,
  openDraft,
}: {
  card: BuildCard;
  detail: BuildDetail;
  open: () => void;
  openDraft: () => void;
}) {
  if (card.status !== "completed") return null;
  if (detail.githubLink?.postedAt) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="text-emerald-700 dark:text-emerald-300">✓ Completion summary posted to GitHub</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <button
        onClick={open}
        className="cursor-pointer min-h-11 font-medium text-primary hover:underline"
      >
        Share completion summary on GitHub…
      </button>
      <button
        onClick={openDraft}
        className="cursor-pointer min-h-11 font-medium text-primary hover:underline"
      >
        Draft GitHub comment…
      </button>
    </div>
  );
}
