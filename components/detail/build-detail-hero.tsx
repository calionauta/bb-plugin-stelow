import { selectBuildReviewArtifact } from "../../lib/build-review-target.mjs";
import { Button } from "@/components/ui/button";
import { fileLinkTarget } from "../artifacts/artifact-inventory";
import type { BuildDetailView } from "./build-detail-body";
import { DetailQuestionSections } from "./detail-question-sections";
import { DetailHeroActions } from "./detail-hero-actions";
import { HERO_STYLE, heroFor } from "./detail-hero";

const SPLIT_PROPOSAL_TITLE = [
  "Ask the worker for a real split proposal now (one option per delivery plus Keep as one card).",
  "Only a --tag split proposal can create cards.",
].join(" ");

type BuildCard = NonNullable<BuildDetailView["card"]>;
type ReviewHero = NonNullable<ReturnType<typeof heroFor>>;
type ReviewTarget = { display: string; path: string; relPath: string; hostId: string } | null;

type BuildReviewHeroProps = {
  view: BuildDetailView;
  presetStale: boolean;
};

function heroModel(view: BuildDetailView) {
  const { card, detail } = view;
  const hero = card ? heroFor(card, detail) : null;
  const artifact = selectBuildReviewArtifact({
    detail,
    card,
    heroKind: hero?.kind ?? null,
  });
  const target = artifact?.absolutePath
    ? {
        display: artifact.display ?? "artifact",
        path: artifact.absolutePath,
        relPath: artifact.path ?? artifact.absolutePath,
        hostId: artifact.hostId ?? "",
      }
    : null;
  return { hero, heroStyle: hero ? HERO_STYLE[hero.kind] : null, target };
}

export function BuildReviewHero({ view, presetStale }: BuildReviewHeroProps) {
  const { card, detail } = view;
  const { hero, heroStyle, target } = heroModel(view);
  if (!card || !hero || !heroStyle) return null;
  return (
    <section
      aria-label="Card status"
      {...(heroStyle.alert ? { role: "alert" } : {})}
      className={`rounded-lg border p-4 ${heroStyle.wrap}`}
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${heroStyle.dot}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-[16px] font-semibold leading-snug tracking-tight text-foreground">
            {hero.title}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{hero.sub}</p>
          <p className="pt-1 text-[15px] leading-relaxed text-foreground">{card.prompt}</p>
          <RecoveryPrompt card={card} view={view} />
          <BuildHeroActions
            card={card}
            detail={detail}
            hero={hero}
            presetStale={presetStale}
            target={target}
            view={view}
          />
        </div>
      </div>
      {detail
        ? (
          <DetailQuestionSections
            card={card}
            detail={detail}
            setViewerFile={view.setViewerFile}
            onAnswered={() => void view.load()}
            openLiveArtifact
          />
        )
        : null}
      <HeroSplitAction detail={detail} view={view} />
    </section>
  );
}

type BuildHeroActionsProps = {
  card: BuildCard;
  detail: BuildDetailView["detail"];
  hero: ReviewHero;
  presetStale: boolean;
  target: ReviewTarget;
  view: BuildDetailView;
};

function BuildHeroActions({
  card,
  detail,
  hero,
  presetStale,
  target,
  view,
}: BuildHeroActionsProps) {
  const { lifecycle } = view;
  return (
    <DetailHeroActions
      card={card}
      heroKind={hero.kind}
      pending={Boolean(detail?.pendingQuestions[0])}
      preset={{
        stale: presetStale,
        providerId: detail?.card.presetProviderId ?? null,
        modelId: detail?.card.presetModelId ?? null,
      }}
      state={{
        starting: lifecycle.starting,
        retrying: lifecycle.retrying,
        restarting: lifecycle.restarting,
      }}
      continuation="continuing from the current stage"
      retryTail=" from the current stage"
      extra={hero.kind === "decision" && target
        ? <ReviewButton card={card} detail={detail} target={target} setViewerFile={view.setViewerFile} />
        : null}
      onStart={lifecycle.doStart}
      onRetry={lifecycle.doRetry}
      onRestart={() => lifecycle.setRestartWorkerOpen(true)}
    />
  );
}

function RecoveryPrompt({ card, view }: { card: BuildCard; view: BuildDetailView }) {
  if (card.workspaceKind !== "exploratory") return null;
  const recovery = view.lifecycle.workspaceRecovery;
  return (
    <p
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
      title={card.workspacePath ?? undefined}
    >
      <span>Exploratory work · stored locally</span>
      {recovery?.kind === "promote"
        ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              view.lifecycle.setPromoteName(card.displayName);
              view.lifecycle.setPromoteOpen(true);
            }}
            title="This workspace contains source material. Create a BB project without moving files."
          >
            Turn into project…
          </Button>
        )
        : null}
      {recovery && recovery.kind !== "attached" && recovery.candidates.length > 0
        ? (
          <span className="font-medium text-amber-800 dark:text-amber-200">
            Reported code checkout needs review below.
          </span>
        )
        : null}
    </p>
  );
}

function ReviewButton({
  card,
  detail,
  target,
  setViewerFile,
}: {
  card: BuildCard;
  detail: BuildDetailView["detail"];
  target: { display: string; path: string; relPath: string; hostId: string };
  setViewerFile: BuildDetailView["setViewerFile"];
}) {
  const open = () => setViewerFile({
    display: target.display,
    path: target.path,
    target: fileLinkTarget(
      card.workspaceKind === "exploratory",
      detail?.fileEnvironmentId ?? null,
      target.relPath,
      target.hostId,
      target.path,
    ),
    mode: "review",
  });
  return (
    <span className="w-full">
      <Button
        size="sm"
        variant="outline"
        onClick={open}
        title={`Read ${target.display} before deciding`}
      >
        Review {target.display} ↗
      </Button>
    </span>
  );
}

function HeroSplitAction({
  detail,
  view,
}: {
  detail: BuildDetailView["detail"];
  view: BuildDetailView;
}) {
  if (!detail?.splitAction?.show) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
      {detail.splitAction.ok
        ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={view.lifecycle.splitting}
              onClick={() => void view.lifecycle.doRequestSplit()}
              title={SPLIT_PROPOSAL_TITLE}
            >
              Propose split…
            </Button>
            <span className="text-xs text-muted-foreground">
              One option per delivery, approved by you, executed by the host.
            </span>
          </>
        )
        : <span className="text-xs text-muted-foreground">{detail.splitAction.reason}</span>}
      {view.lifecycle.splitError
        ? <span className="w-full text-xs text-destructive">{view.lifecycle.splitError}</span>
        : null}
    </div>
  );
}
