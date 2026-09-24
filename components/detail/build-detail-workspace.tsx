import { UrlLink } from "@get-bb/plugin-sdk/app";
import { STAGE_TO_BAND, stageLabel } from "../../lib/workflow-vocabulary.mjs";
import { checkoutNoteFor, WorkerSection } from "../worker-history/worker-history";
import { LinkedDiscussionSection } from "../github/github-linked-discussion";
import type { BuildDetailView } from "./build-detail-body";
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
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        Imported from{" "}
        <UrlLink
          href={detail.githubLink?.url ?? ""}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {detail.githubLink?.repo}#{detail.githubLink?.number}
        </UrlLink>
      </span>
      {card.status === "completed"
        ? detail.githubLink?.postedAt
          ? (
            <span className="text-emerald-700 dark:text-emerald-300">
              ✓ Completion summary posted to GitHub
            </span>
          )
          : (
            <>
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
            </>
          )
        : <span>A completion summary can be posted once this card is Done.</span>}
    </div>
  );
}
