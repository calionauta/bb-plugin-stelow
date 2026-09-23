import { statusTone } from "../../lib/detail-presentation.mjs";
import { researchColumnForStatus } from "../../lib/card-question-state.mjs";
import { LIGHTWEIGHT_COLUMN_LABELS } from "../../lib/tracks.mjs";
import { ArtifactGroups, openAskArtifact } from "../artifacts/artifact-inventory";
import { CardConversation } from "../conversation/card-conversation";
import { ExpiredQuestionsSection, QuestionBatch } from "../conversation/question-batch";
import { LightweightStatusPills } from "../dashboard/build-status-pills";
import { DisclosureSection } from "../disclosure";
import { checkoutNoteFor, WorkerSection } from "../worker-history/worker-history";
import { DetailHeroActions } from "./detail-hero-actions";
import { HERO_STYLE, heroFor } from "./detail-hero";
import { ExploreQualitySection } from "./explore-quality-section";
import type { ExploreCard, ExploreDetail } from "./explore-detail-types";
import { InboxEventBanner, shouldShowInboxEventBanner } from "./inbox-event-banner";
import { InputFiles } from "./input-files";
import { PreviewSection } from "./preview-section";
import type { useExploreDetailState } from "./use-explore-detail-state";

type ExploreDetailState = ReturnType<typeof useExploreDetailState>;
type ExploreContentProps = {
  inboxEventId: string | null;
  inboxEvent: InboxDetailEvent | null;
  card: ExploreCard;
  detail: ExploreDetail | null;
  stageLabel: string | null;
  state: ExploreDetailState;
  onChanged: () => void;
};
type InboxDetailEvent = Parameters<typeof InboxEventBanner>[0]["event"];

function ExploreQuestions({ card, detail, setViewerFile, onChanged }: Pick<ExploreContentProps, "card" | "detail" | "onChanged"> & {
  setViewerFile: ExploreDetailState["setViewerFile"];
}) {
  const pendingFirst = detail?.pendingQuestions?.[0] ?? null;
  if (!pendingFirst && !detail?.expiredQuestions.length) return null;
  return (
    <>
      {pendingFirst ? (
        <div className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
          <QuestionBatch cardId={card.id} mode="live" questions={detail?.pendingQuestions.map((question) => ({ id: question.id, title: question.title, prompt: question.question, multiple: question.multiple, kind: question.kind, options: question.options, staleness: question.staleness ?? null })) ?? []} onAnswered={() => onChanged()} />
        </div>
      ) : null}
      {detail && detail.expiredQuestions.length > 0 ? <div className="mt-3 border-t border-amber-500/20 pt-3"><ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} onOpenArtifact={(artifact, mode) => openAskArtifact(card, detail.fileEnvironmentId, setViewerFile, artifact, mode)} onAnswered={() => onChanged()} /></div> : null}
    </>
  );
}

function ExploreStatus({ card, detail, stageLabel, state, onChanged }: Pick<ExploreContentProps, "card" | "detail" | "stageLabel" | "state" | "onChanged">) {
  const hero = heroFor(card, detail);
  const heroStyle = HERO_STYLE[hero.kind];
  const presetStale = Boolean(detail && card.workerThreadId && (detail.card.presetRestartPending || (detail.card.workerPresetId && detail.card.workerPresetId !== detail.card.presetId)));
  return (
    <section aria-label="Exploration status" {...(heroStyle.alert ? { role: "alert" } : {})} className={`rounded-lg border p-4 ${heroStyle.wrap}`}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${heroStyle.dot}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-[16px] font-semibold leading-snug tracking-tight text-foreground">{hero.title}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{hero.sub}</p>
          <p className="pt-1 text-[15px] leading-relaxed text-foreground">{card.prompt}</p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <LightweightStatusPills card={card} statusTone={statusTone} columnLabel={LIGHTWEIGHT_COLUMN_LABELS[researchColumnForStatus(card.status)] ?? null} tagLabel={stageLabel} tagTitle="Technique — the focused approach this exploration runs." kind="explore" />
            {card.workspaceKind === "exploratory" ? <p className="text-xs text-muted-foreground" title={card.workspacePath ?? undefined}>Exploratory work · stored locally</p> : null}
          </div>
          <DetailHeroActions card={card} heroKind={hero.kind} pending={Boolean(detail?.pendingQuestions?.[0])} preset={{ stale: presetStale, providerId: detail?.card.presetProviderId ?? null, modelId: detail?.card.presetModelId ?? null }} state={{ starting: state.actions.starting, retrying: state.actions.retrying, restarting: state.actions.restarting }} continuation="continuing the exploration" onStart={state.actions.start} onRetry={state.actions.doRetry} onRestart={() => state.setRestartWorkerOpen(true)} />
        </div>
      </div>
      <ExploreQuestions card={card} detail={detail} setViewerFile={state.setViewerFile} onChanged={onChanged} />
    </section>
  );
}

function ExploreArtifacts({ card, detail, stageLabel, setViewerFile }: Pick<ExploreContentProps, "card" | "detail" | "stageLabel"> & {
  setViewerFile: ExploreDetailState["setViewerFile"];
}) {
  return (
    <DisclosureSection title="Artifacts" hint={detail ? `${detail.artifacts.length} files` : "being prepared"} defaultOpen>
      {detail ? <ArtifactGroups artifacts={detail.artifacts} workspaceKind={card.workspaceKind} fileEnvironmentId={detail.fileEnvironmentId} onView={setViewerFile} groupTitleForStage={() => stageLabel ?? "Exploration"} /> : <p className="text-xs text-muted-foreground">Loading…</p>}
    </DisclosureSection>
  );
}

export function ExploreDetailContent({ inboxEventId, inboxEvent, card, detail, stageLabel, state, onChanged }: ExploreContentProps) {
  const hero = heroFor(card, detail);
  const qualityPath = detail?.artifacts.map((item) => item.path).find((path) => card.exploreStage != null && path.endsWith(`explore-${card.exploreStage}.md`)) ?? null;
  return (
    <>
      <InboxEventBanner visible={Boolean(inboxEventId) && shouldShowInboxEventBanner(inboxEvent, hero)} event={inboxEvent} sectionRef={state.inboxEventRef} />
      <ExploreStatus card={card} detail={detail} stageLabel={stageLabel} state={state} onChanged={onChanged} />
      <WorkerSection card={card} detail={detail} presetStale={Boolean(detail && card.workerThreadId && (detail.card.presetRestartPending || (detail.card.workerPresetId && detail.card.workerPresetId !== detail.card.presetId)))} restarting={state.actions.restarting} onRestartWorker={() => state.setRestartWorkerOpen(true)} onPreset={() => state.setPresetDialogOpen(true)} presetPill={<>Explore · {detail?.card.presetName ?? "default"}</>} presetNote={<>Applies to the next worker — Resume keeps the current one.</>} pillTitle="Preset for the next worker" checkoutNote={checkoutNoteFor(detail?.card.environmentLabel)} />
      <InputFiles card={card} detail={detail} onView={state.setViewerFile} />
      <PreviewSection cardId={card.id} />
      <ExploreQualitySection cardId={card.id} filePath={qualityPath} repairing={state.actions.repairing} onRepair={(lines) => void state.actions.doQualityRepair(lines)} />
      <ExploreArtifacts card={card} detail={detail} stageLabel={stageLabel} setViewerFile={state.setViewerFile} />
      <CardConversation comments={detail?.comments ?? []} draft={state.comment} onDraftChange={state.setComment} onSend={() => void state.submitComment()} defaultOpen={hero.kind === "decision"} threadId={card.workerThreadId ?? null} />
    </>
  );
}
