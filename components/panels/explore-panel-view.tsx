import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { kanbanGridColumns } from "../../lib/kanban-layout.mjs";
import {
  LIGHTWEIGHT_COLUMN_LABELS,
  LIGHTWEIGHT_VISIBLE_COLUMNS,
} from "../../lib/tracks.mjs";
import { trackTitle } from "../panel/stelow-route.mjs";
import { FiltersBar } from "../board/board-filters";
import { ViewToggle } from "../board/board-view-toggle";
import { ExploreList } from "../board/track-lists";
import { BoardColumn } from "../board/board-column";
import { ExploreCard } from "../board/board-cards";
import { BucketGalleryButton } from "../board/card-gallery";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import type { ExploreCard as ExplorePanelCard, useExplorePanelState } from "./explore-panel-state";

type ExploreState = ReturnType<typeof useExplorePanelState>;
type ExploreProps = {
  state: ExploreState;
  dialogs: ReactNode;
  onNewExplore: () => void;
  onOpenPresets: () => void;
  onOpenCard: (card: Pick<ExplorePanelCard, "kind">, cardId: string) => void;
  onOpenThread: (threadId: string) => void;
  onMoveCard: (cardId: string, target: string) => void;
};

function ExploreHeader(props: ExploreProps) {
  const attentionCount = props.state.attentionCount;
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">Explore</h1>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
          Choose a single technique from the {trackTitle("build")} workflow — an AI agent runs it on your input, returning a focused result on the card.
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
        <Button className="min-h-11 w-full sm:w-auto sm:flex-none" onClick={props.onNewExplore}>
          <Icon name="Plus" className="h-4 w-4" aria-hidden />
          New exploration
        </Button>
        <BucketGalleryButton
          cards={props.state.grouped.inbox ?? []}
          onOpenCard={(card) => props.onOpenCard(card, card.id)}
        />
        <Button
          className="min-h-11 w-full sm:w-auto sm:flex-none"
          variant="outline"
          onClick={props.onOpenPresets}
          title="Manage agent presets and the band default"
        >
          <Icon name="Settings" className="h-4 w-4" aria-hidden />
          Agent Presets
        </Button>
      </div>
    </header>
  );
}

function ExploreFilters({ state }: { state: ExploreState }) {
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
        track="explore"
        onChange={state.setViewMode}
        label="Explore cards view"
      />
    </div>
  );
}

function ExploreBoard(props: ExploreProps) {
  const { state } = props;
  if (state.viewMode === "list") {
    return (
      <ExploreList
        groups={state.grouped}
        stageLabelById={state.labels}
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
            <ExploreCard
              card={card}
              stageLabel={card.exploreStage ? (state.labels.get(card.exploreStage) ?? card.exploreStage) : null}
              onOpen={() => props.onOpenCard(card, card.id)}
            />
          )}
        />
      ))}
    </div>
  );
}

export function ExplorePanelView(props: ExploreProps) {
  return (
    <>
      <ExploreHeader {...props} />
      {props.dialogs}
      <ExploreFilters state={props.state} />
      {props.state.viewMode === "board" ? (
        <p className="text-xs text-muted-foreground">
          <span className="sm:hidden">Swipe sideways to view every stage.</span>
          <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
        </p>
      ) : null}
      <ExploreBoard {...props} />
    </>
  );
}
