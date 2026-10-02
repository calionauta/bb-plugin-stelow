import { isWorkerPresetStale } from "../../lib/preset-staleness.mjs";
import { CardConversation } from "../conversation/card-conversation";
import { startsOpen } from "../disclosure";
import type { BuildDetailView } from "./build-detail-view";
import { BuildReviewHero } from "./build-detail-hero";
import { BuildArtifacts, BuildProgressSection } from "./build-detail-progress";
import { StageSection } from "./stage-section";
import { BuildReviewTools } from "./build-detail-review-tools";
import { BuildWorkspace } from "./build-detail-workspace";
import { CatchUpSection } from "./catch-up-section";
import { heroFor } from "./detail-hero";
import { ExploreDetailBody } from "./explore-detail-body";
import { InboxEventBanner, shouldShowInboxEventBanner } from "./inbox-event-banner";
import { ResearchDetailBody } from "./research-detail-body";

type BuildContentProps = {
  cardId: string;
  inboxEventId: string | null;
  view: BuildDetailView;
};

export function BuildDetailContent({ cardId, inboxEventId, view }: BuildContentProps) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {view.error ? <p className="text-sm text-destructive">{view.error}</p> : null}
        <CardKindContent cardId={cardId} inboxEventId={inboxEventId} view={view} />
      </div>
    </div>
  );
}

function CardKindContent({ cardId, inboxEventId, view }: BuildContentProps) {
  const { card, detail, load, inboxEvent } = view;
  if (!card) return null;
  if (card.kind === "research") {
    return (
      <ResearchDetailBody
        cardId={cardId}
        inboxEventId={inboxEventId}
        inboxEvent={inboxEvent}
        card={card}
        detail={detail}
        onChanged={() => void load()}
      />
    );
  }
  if (card.kind === "explore") {
    return (
      <ExploreDetailBody
        cardId={cardId}
        inboxEventId={inboxEventId}
        inboxEvent={inboxEvent}
        card={card}
        detail={detail}
        onChanged={() => void load()}
      />
    );
  }
  return <BuildCardContent cardId={cardId} inboxEventId={inboxEventId} view={view} />;
}

function BuildCardContent({ cardId, inboxEventId, view }: BuildContentProps) {
  const { card, detail } = view;
  if (!card || !detail) return null;
  const hero = heroFor(card, detail);
  const presetStale = isWorkerPresetStale(card, detail);
  return (
    <>
      <InboxEventBanner
        visible={Boolean(inboxEventId) && shouldShowInboxEventBanner(view.inboxEvent, hero)}
        event={view.inboxEvent}
        sectionRef={view.inboxEventRef}
      />
      <BuildReviewHero view={view} presetStale={presetStale} />
      {/* Review tools are the reason to open a finished card, and they used to
          sit below Artifacts and the workflow map — six sections down, past the
          diff's own visibility gate. A completed card leads with them. */}
      {card.status === "completed" ? <BuildReviewTools cardId={cardId} view={view} /> : null}
      <CatchUpSection cardId={cardId} />
      <BuildWorkspace view={view} presetStale={presetStale} />
      <BuildProgressSection view={view} />
      {/* The stage timeline, the run history and the stage reference were three
          sibling sections, and a reader asking where the card was had to hold
          three scroll positions to answer it. They are one section now, with
          three named regions: see components/detail/stage-section.tsx. */}
      <StageSection
        card={card}
        detail={detail}
        runs={view.execution}
        focusRunId={view.focusRunId}
        intentLabels={view.intentLabels}
        onPickStage={view.setPendingAdvance}
        mapOpen={view.mapOpen}
        onMapToggle={view.setMapOpen}
      />
      <BuildArtifacts view={view} />
      {card.status === "completed" ? null : <BuildReviewTools cardId={cardId} view={view} />}
      <CardConversation
        comments={detail?.comments ?? []}
        draft={view.comments.comment}
        onDraftChange={view.comments.setComment}
        onSend={() => void view.comments.submitComment()}
        defaultOpen={startsOpen({ blocking: hero?.kind === "decision" })}
        threadId={card.workerThreadId ?? null}
      />
    </>
  );
}