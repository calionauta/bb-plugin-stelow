import { useMemo, type Dispatch, type SetStateAction } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { researchColumnForStatus } from "../../lib/card-question-state.mjs";
import { groupResearchArtifacts } from "../../lib/artifact-groups.mjs";
import { joinStrategyLabels, statusTone } from "../../lib/detail-presentation.mjs";
import { parseResearchIndexSections } from "../../lib/research-index-sections.mjs";
import { isWorkerPresetStale } from "../../lib/preset-staleness.mjs";
import { researchOpportunityHint } from "../../lib/research-opportunity-summary.mjs";
import { LIGHTWEIGHT_COLUMN_LABELS } from "../../lib/tracks.mjs";
import { ArtifactInventory, type ArtifactInventoryGroup } from "../artifacts/artifact-inventory";
import { CardConversation } from "../conversation/card-conversation";
import { LightweightStatusPills } from "../dashboard/build-status-pills";
import { DisclosureSection } from "../disclosure";
import { DetailQuestionSections } from "./detail-question-sections";
import { DetailHeroActions } from "./detail-hero-actions";
import { HERO_STYLE, heroFor } from "./detail-hero";
import { InboxEventBanner, shouldShowInboxEventBanner, type InboxEventItem } from "./inbox-event-banner";
import { InputFiles } from "./input-files";
import { PreviewSection } from "./preview-section";
import { ResearchQualitySection } from "./research-quality-section";
import type { ResearchIndexState } from "./research-detail-dialogs";
import type { ResearchCard, ResearchDetail, ViewerFile } from "./research-detail-types";
import { checkoutNoteFor, WorkerSection } from "../worker-history/worker-history";
import { Button } from "@/components/ui/button";
import type { ResearchStrategyOption } from "../creation/creation-settings";

type ResearchContentProps = {
  cardId: string;
  inboxEventId: string | null;
  inboxEvent: InboxEventItem | null;
  card: ResearchCard;
  detail: ResearchDetail | null;
  index: ResearchIndexState | null;
  strategies: ResearchStrategyOption[];
  comment: string;
  setComment: (value: string) => void;
  submitComment: () => Promise<void>;
  actions: ReturnType<typeof import("./use-research-detail-state")["useResearchDetailState"]>["actions"];
  onOpenRestart: () => void;
  onOpenPreset: () => void;
  onOpenFanOut: () => void;
  onOpenStrategyRun: () => void;
  onQuestionsChanged: () => void;
  setViewerFile: Dispatch<SetStateAction<ViewerFile | null>>;
  inboxEventRef: React.RefObject<HTMLElement | null>;
};

type ResearchStatusProps = Pick<ResearchContentProps, "card" | "detail" | "index" | "strategies" | "actions" | "onOpenRestart" | "onOpenPreset" | "setViewerFile" | "onQuestionsChanged">;

function ResearchStatus({ card, detail, index, strategies, actions, onOpenRestart, onOpenPreset, setViewerFile, onQuestionsChanged }: ResearchStatusProps) {
  const hero = heroFor(card, detail);
  const heroStyle = HERO_STYLE[hero.kind];
  const labels = useMemo(() => new Map(strategies.map((entry) => [entry.id, entry.label])), [strategies]);
  const strategyLabel = joinStrategyLabels(card.researchStrategies ?? [card.researchStrategy], labels);
  const available = index?.opportunities.filter((item) => !item.checked) ?? [];
  const presetStale = isWorkerPresetStale(card, detail);
  return (
    <>
      <section aria-label="Research status" {...(heroStyle.alert ? { role: "alert" } : {})} className={`rounded-lg border p-4 ${heroStyle.wrap}`}>
        <div className="flex items-start gap-2.5">
          <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${heroStyle.dot}`} />
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-[16px] font-semibold leading-snug tracking-tight text-foreground">{hero.title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{hero.sub}</p>
            <p className="pt-1 text-[15px] leading-relaxed text-foreground">{card.prompt}</p>
            {index?.found && available.length > 0 && card.status !== "completed" && card.status !== "archived" ? <p className="text-xs text-muted-foreground">Review the results below, select opportunities to build, then move this card to Done.</p> : null}
            <ResearchIdentity card={card} strategyLabel={strategyLabel} />
            <ResearchHeroActions
              card={card}
              detail={detail}
              hero={hero}
              presetStale={presetStale}
              actions={actions}
              onOpenRestart={onOpenRestart}
            />
          </div>
        </div>
        <ResearchQuestions
          card={card}
          detail={detail}
          setViewerFile={setViewerFile}
          onQuestionsChanged={onQuestionsChanged}
        />
      </section>
      <WorkerSection
        card={card}
        detail={detail}
        presetStale={presetStale}
        restarting={actions.restarting}
        onRestartWorker={onOpenRestart}
        onPreset={onOpenPreset}
        presetPill={<>Research · {detail?.card.presetName ?? "default"}</>}
        presetNote={<>Applies to the next worker — Resume keeps the current one.</>}
        pillTitle="Preset for the next worker"
        checkoutNote={checkoutNoteFor(detail?.card.environmentLabel)}
      />
    </>
  );
}

type ResearchQuestionsProps = Pick<
  ResearchStatusProps,
  "card" | "detail" | "setViewerFile" | "onQuestionsChanged"
>;

function ResearchQuestions({
  card,
  detail,
  setViewerFile,
  onQuestionsChanged,
}: ResearchQuestionsProps) {
  if (!detail) return null;
  return (
    <DetailQuestionSections
      card={card}
      detail={detail}
      setViewerFile={setViewerFile}
      onAnswered={onQuestionsChanged}
      openLiveArtifact
    />
  );
}

type ResearchHeroActionsProps = Pick<ResearchStatusProps, "card" | "detail" | "actions" | "onOpenRestart"> & {
  hero: ReturnType<typeof heroFor>;
  presetStale: boolean;
};

function ResearchHeroActions({
  card,
  detail,
  hero,
  presetStale,
  actions,
  onOpenRestart,
}: ResearchHeroActionsProps) {
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
        starting: actions.starting,
        retrying: actions.retrying,
        restarting: actions.restarting,
      }}
      continuation="continuing the research"
      onStart={actions.start}
      onRetry={actions.doRetry}
      onRestart={onOpenRestart}
    />
  );
}

function ResearchIdentity({ card, strategyLabel }: { card: ResearchCard; strategyLabel: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <LightweightStatusPills card={card} statusTone={statusTone} columnLabel={LIGHTWEIGHT_COLUMN_LABELS[researchColumnForStatus(card.status)] ?? null} tagLabel={strategyLabel} tagTitle="Research strategy — the playbook driving this investigation." kind="research" />
      {card.workspaceKind === "exploratory" ? <p className="text-xs text-muted-foreground" title={card.workspacePath ?? undefined}>Exploratory work · stored locally</p> : null}
    </div>
  );
}

function ResearchOpportunities({ index, onOpenFanOut, onOpenStrategyRun }: { index: ResearchIndexState; onOpenFanOut: () => void; onOpenStrategyRun: () => void }) {
  const available = index.opportunities.filter((item) => !item.checked);
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Opportunities</h4>
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={onOpenStrategyRun} title="Run another strategy on the same request. Its findings are added to these results.">Explore another strategy…</Button>
          <Button size="sm" variant="outline" disabled={available.length === 0} onClick={onOpenFanOut} title="Select opportunities, then create the build cards.">Select To Build</Button>
        </span>
      </div>
      <ul className="space-y-1">{index.opportunities.map((item) => <li key={item.id} className="flex items-start gap-2 text-sm"><span className="mt-0.5 shrink-0" aria-hidden>•</span><span className={item.checked ? "text-muted-foreground line-through" : ""}>{item.title}</span>{item.checked ? <span className="shrink-0 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">fanned out</span> : null}</li>)}</ul>
    </div>
  );
}

function ResearchSummary({ index, groups, body, onOpenFanOut, onOpenStrategyRun }: { index: ResearchIndexState | null; groups: ArtifactInventoryGroup[]; body: ReturnType<typeof parseResearchIndexSections> | null; onOpenFanOut: () => void; onOpenStrategyRun: () => void }) {
  const available = index?.opportunities.filter((item) => !item.checked) ?? [];
  return (
    <DisclosureSection title="Research summary" hint={index?.found ? researchOpportunityHint(available.length, index.opportunities.length) : "being prepared"} defaultOpen>
      {!index ? <p className="text-xs text-muted-foreground">Preparing results…</p> : null}
      {index && !index.found ? <p className="text-xs text-muted-foreground">Results are still being prepared.</p> : null}
      {index?.found && body?.summary ? <div className="text-sm leading-relaxed"><Markdown content={body.summary} /></div> : null}
      {index?.found && groups.length > 0 ? <p className="text-xs text-muted-foreground">Read the artifacts for the full evidence and detail.</p> : null}
      {index?.truncated ? <p className="text-xs text-muted-foreground">Results are shortened here. Open the full research file at {index.indexPath}.</p> : null}
      {index?.found && index.opportunities.length > 0 ? <ResearchOpportunities index={index} onOpenFanOut={onOpenFanOut} onOpenStrategyRun={onOpenStrategyRun} /> : null}
    </DisclosureSection>
  );
}

function ResearchArtifacts({ card, detail, groups, setViewerFile }: { card: ResearchCard; detail: ResearchDetail | null; groups: ArtifactInventoryGroup[]; setViewerFile: Dispatch<SetStateAction<ViewerFile | null>> }) {
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  return (
    <DisclosureSection title="Artifacts" hint={count > 0 ? `${count} ${count === 1 ? "file" : "files"} · newest round first` : "being prepared"} defaultOpen>
      <ArtifactInventory groups={groups} workspaceKind={card.workspaceKind} fileEnvironmentId={detail?.fileEnvironmentId ?? null} onView={setViewerFile} />
    </DisclosureSection>
  );
}

export function ResearchDetailContent(props: ResearchContentProps) {
  const { card, detail, index, actions, comment, setComment, submitComment, setViewerFile, inboxEventId, inboxEvent, inboxEventRef } = props;
  const hero = heroFor(card, detail);
  const body = useMemo(() => (index?.found && index.content ? parseResearchIndexSections(index.content) : null), [index]);
  const groups = useMemo<ArtifactInventoryGroup[]>(() => groupResearchArtifacts(index?.rounds, body?.outputs), [index?.rounds, body?.outputs]);
  return (
    <>
      <InboxEventBanner visible={Boolean(inboxEventId) && shouldShowInboxEventBanner(inboxEvent, hero)} event={inboxEvent} sectionRef={inboxEventRef} />
      <ResearchStatus {...props} />
      <InputFiles card={card} detail={detail} onView={setViewerFile} />
      <ResearchSummary index={index} groups={groups} body={body} onOpenFanOut={props.onOpenFanOut} onOpenStrategyRun={props.onOpenStrategyRun} />
      <PreviewSection cardId={card.id} />
      <ResearchQualitySection rounds={index?.rounds ?? []} repairing={actions.repairing} onRepair={(lines) => void actions.doQualityRepair(lines)} />
      <ResearchArtifacts card={card} detail={detail} groups={groups} setViewerFile={setViewerFile} />
      <CardConversation comments={detail?.comments ?? []} draft={comment} onDraftChange={setComment} onSend={() => void submitComment()} defaultOpen={hero.kind === "decision"} threadId={card.workerThreadId ?? null} />
    </>
  );
}
