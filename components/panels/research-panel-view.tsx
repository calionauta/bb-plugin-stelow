import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { joinStrategyLabels } from "../../lib/detail-presentation.mjs";
import { kanbanGridColumns } from "../../lib/kanban-layout.mjs";
import {
  LIGHTWEIGHT_COLUMN_LABELS,
  LIGHTWEIGHT_VISIBLE_COLUMNS,
} from "../../lib/tracks.mjs";
import { trackTitle } from "../panel/stelow-route.mjs";
import { FiltersBar } from "../board/board-filters";
import { ViewToggle } from "../board/board-view-toggle";
import { ResearchList } from "../board/track-lists";
import { BoardColumn } from "../board/board-column";
import { ResearchCard } from "../board/board-cards";
import { BucketGalleryButton } from "../board/card-gallery";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import type {
  ResearchCard as ResearchPanelCard,
  useResearchPanelState,
} from "./research-panel-state";

type ResearchState = ReturnType<typeof useResearchPanelState>;
type ResearchProps = {
  state: ResearchState;
  dialogs: ReactNode;
  onNewResearch: () => void;
  onOpenPresets: () => void;
  onOpenCard: (card: Pick<ResearchPanelCard, "kind">, cardId: string) => void;
  onOpenThread: (threadId: string) => void;
  onMoveCard: (cardId: string, target: string) => void;
};

function ResearchHeader(props: ResearchProps) {
  const attentionCount = props.state.attentionCount;
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">Research</h1>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
          An AI agent applies specialized research strategy to surface prioritized opportunities you can turn into {trackTitle("build")} cards.
        </p>
        {attentionCount > 0 ? (
          <button
            type="button"
            onClick={() => props.state.setAttention(true)}
            className={cn(
              "mt-0.5 inline-flex min-h-11 cursor-pointer items-center text-xs text-amber-700 underline-offset-4",
              "hover:underline focus-visible:outline focus-visible:outline-2",
              "focus-visible:outline-primary dark:text-amber-300",
            )}
            aria-label={`Show the ${attentionCount} ${attentionCount === 1 ? "card" : "cards"} that need attention`}
          >
            {attentionCount} {attentionCount === 1 ? "item needs" : "items need"} your attention
          </button>
        ) : null}
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:mt-0.5 sm:flex sm:w-auto sm:items-center sm:gap-3">
        <Button className="min-h-11 w-full sm:w-auto sm:flex-none" onClick={props.onNewResearch}>
          <Icon name="Plus" className="h-4 w-4" aria-hidden />
          New research
        </Button>
        <BucketGalleryButton
          cards={props.state.grouped.inbox ?? []}
          onOpenCard={(card) => props.onOpenCard(card, card.id)}
        />
        <Button
          className="min-h-11 w-full sm:w-auto sm:flex-none"
          variant="outline"
          onClick={props.onOpenPresets}
          title="Manage agent presets and the research band default"
        >
          <Icon name="Settings" className="h-4 w-4" aria-hidden />
          Agent Presets
        </Button>
      </div>
    </header>
  );
}

function ResearchFilters({ state }: { state: ResearchState }) {
  return (
    <div className="flex items-start gap-2 border-b pb-3">
      <div className="min-w-0 flex-1">
        <FiltersBar
          projects={state.data.projects}
          filterProjectIds={state.projectIds}
          filterAttention={state.attention}
          onProjectToggle={state.toggleProject}
          onAttention={state.setAttention}
          onReset={state.reset}
        />
      </div>
      <ViewToggle
        view={state.viewMode}
        track="research"
        onChange={state.setViewMode}
        label="Research cards view"
      />
    </div>
  );
}

function ResearchBoard(props: ResearchProps) {
  const { state } = props;
  if (state.viewMode === "list") {
    return (
      <ResearchList
        groups={state.grouped}
        strategyLabelById={state.labels}
        collapsed={state.collapsedListGroups}
        onToggle={state.toggleListGroup}
        onOpenCard={(card) => props.onOpenCard(card, card.id)}
        onOpenThread={props.onOpenThread}
      />
    );
  }
  return (
    <div
      data-testid="kanban-board"
      className="grid justify-start gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden"
      style={{ gridTemplateColumns: kanbanGridColumns(LIGHTWEIGHT_VISIBLE_COLUMNS, state.collapsedColumns) }}
    >
      {LIGHTWEIGHT_VISIBLE_COLUMNS.map((column) => (
        <BoardColumn
          key={column}
          column={column}
          cards={state.grouped[column]}
          collapsed={Boolean(state.collapsedColumns[column])}
          onToggleCollapsed={() => state.toggleColumn(column)}
          onDrop={(cardId) => props.onMoveCard(cardId, column)}
          labels={LIGHTWEIGHT_COLUMN_LABELS}
          renderCard={(card) => (
            <ResearchCard
              card={card}
              strategyLabel={joinStrategyLabels(card.researchStrategies ?? [], state.labels)}
              onOpen={() => props.onOpenCard(card, card.id)}
            />
          )}
        />
      ))}
    </div>
  );
}

export function ResearchPanelView(props: ResearchProps) {
  return (
    <>
      <ResearchHeader {...props} />
      {props.dialogs}
      <ResearchFilters state={props.state} />
      {props.state.viewMode === "board" ? (
        <p className="text-xs text-muted-foreground">
          <span className="sm:hidden">Swipe sideways to view every stage.</span>
          <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
        </p>
      ) : null}
      <ResearchBoard {...props} />
    </>
  );
}
