import type { ComponentType, ReactNode } from "react";
import { PanelHeader, BoardScrollHint } from "./panel-header";
import { kanbanGridColumns } from "../../lib/kanban-layout.mjs";
import type { BoardView } from "../../lib/board-views.mjs";
import type { BoardCardItem } from "../board/board-cards";
import type { ListCard } from "../board/track-lists";
import {
  LIGHTWEIGHT_COLUMN_LABELS,
  LIGHTWEIGHT_VISIBLE_COLUMNS,
} from "../../lib/tracks.mjs";
import { trackTitle } from "../panel/stelow-route.mjs";
import { FiltersBar } from "../board/board-filters";
import { ViewToggle } from "../board/board-view-toggle";
import { BoardColumn } from "../board/board-column";
import { archivedDeleteProps } from "../board/archived-delete-props";
import { useDeleteArchivedCards } from "../board/use-delete-archived-cards";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { TrackList } from "../board/track-lists";
import { LightweightTrackCard } from "../board/board-cards";
import { exploreListMeta, researchListMeta } from "../../lib/board-list-presentation.mjs";
import { joinStrategyLabels } from "../../lib/detail-presentation.mjs";
import { BucketGalleryButton } from "../board/card-gallery";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

export type TrackViewConfig = {
  kind: "explore" | "research";
  title: string;
  headerBlurb: ReactNode;
  newLabel: string;
  presetsTitle: string;
  viewLabel: string;
};

export const EXPLORE_VIEW_CONFIG: TrackViewConfig = {
  kind: "explore",
  title: "Explore",
  headerBlurb: (
    <>
      Choose a single technique from the {trackTitle("build")} workflow — an AI agent runs it
      on your input, returning a focused result on the card.
    </>
  ),
  newLabel: "New exploration",
  presetsTitle: "Manage agent presets and the band default",
  viewLabel: "Explore cards view",
};

export const RESEARCH_VIEW_CONFIG: TrackViewConfig = {
  kind: "research",
  title: "Research",
  headerBlurb: (
    <>
      An AI agent applies specialized research strategy to surface prioritized opportunities
      you can turn into {trackTitle("build")} cards.
    </>
  ),
  newLabel: "New research",
  presetsTitle: "Manage agent presets and the research band default",
  viewLabel: "Research cards view",
};

export type TrackViewState = {
  attentionCount: number;
  setAttention: (value: boolean) => void;
  grouped: Record<string, Array<{
    id: string;
    kind?: string;
    status?: string;
    exploreStage?: string | null;
    researchStrategies?: Array<string> | null;
    updatedAt?: number;
  } & Record<string, unknown>>>;
  data: { projects: Array<{ id: string }> };
  projectIds: string[];
  attention: boolean;
  toggleProject: (value: string) => void;
  reset: () => void;
  viewMode: BoardView;
  setViewMode: (mode: BoardView) => void;
  labels: Map<string, string>;
  collapsedColumns: Record<string, boolean>;
  collapsedListGroups: Record<string, boolean>;
  toggleColumn: (column: string) => void;
  toggleListGroup: (column: string) => void;
};

export type TrackListComponent = ComponentType<{
  groups: Record<string, ListCard[]>;
  collapsed: Record<string, boolean>;
  onToggle: (column: string) => void;
  onOpenCard: (card: ListCard) => void;
  onOpenThread: (threadId: string) => void;
  labelById: ReadonlyMap<string, string>;
}>;

export type TrackCardRenderer = (card: BoardCardItem, labelById: ReadonlyMap<string, string>, onOpen: () => void) => ReactNode;

export type TrackViewProps = {
  state: TrackViewState;
  dialogs: ReactNode;
  onNewTrack: () => void;
  onOpenPresets: () => void;
  onOpenCard: (card: { kind: "research" | "explore" | "build" }, cardId: string) => void;
  onOpenThread: (threadId: string) => void;
  config: TrackViewConfig;
  List: TrackListComponent;
  renderCard: TrackCardRenderer;
};

function TrackHeader(props: TrackViewProps) {
  const attentionCount = props.state.attentionCount;
  return (
    <PanelHeader
      title={props.config.title}
      blurb={props.config.headerBlurb}
      attentionCount={attentionCount}
      onAttention={() => props.state.setAttention(true)}
      actions={(
        <>
          <Button className="min-h-11 w-full sm:w-auto sm:flex-none" onClick={props.onNewTrack}>
            <Icon name="Plus" className="h-4 w-4" aria-hidden />
            {props.config.newLabel}
          </Button>
          <BucketGalleryButton
            cards={(props.state.grouped.inbox ?? []) as unknown as BoardCardItem[]}
            onOpenCard={(card) => props.onOpenCard(card, card.id)}
          />
          <Button
            className="min-h-11 w-full sm:w-auto sm:flex-none"
            variant="outline"
            onClick={props.onOpenPresets}
            title={props.config.presetsTitle}
          >
            <Icon name="Settings" className="h-4 w-4" aria-hidden />
            Agent Presets
          </Button>
        </>
      )}
    />
  );
}

function TrackFilters({ state, config }: { state: TrackViewState; config: TrackViewConfig }) {
  return (
    <div className="flex flex-wrap items-start gap-2 border-b pb-3">
      <div className="min-w-0 flex-1">
        <FiltersBar
          projects={state.data.projects as unknown as Array<{ id: string; name: string }>}
          filterProjectIds={state.projectIds}
          filterAttention={state.attention}
          onProjectToggle={state.toggleProject}
          onAttention={state.setAttention}
          onReset={state.reset}
        />
      </div>
      <ViewToggle
        view={state.viewMode}
        track={config.kind}
        onChange={state.setViewMode}
        label={config.viewLabel}
      />
    </div>
  );
}

function TrackBoard(props: TrackViewProps) {
  const { state } = props;
  const onConfirm = useDeleteArchivedCards(useRpc<typeof rpcContract>());
  if (state.viewMode === "list") {
    const groups = state.grouped as unknown as Record<string, ListCard[]>;
    const List = props.List;
    return (
      <List
        groups={groups}
        collapsed={state.collapsedListGroups}
        onToggle={state.toggleListGroup}
        onOpenCard={(card: ListCard) => props.onOpenCard(card, card.id)}
        onOpenThread={props.onOpenThread}
        labelById={state.labels}
      />
    );
  }
  return (
    <div
      data-testid="kanban-board"
      className="grid justify-start gap-3 overflow-x-auto lg:h-[clamp(20rem,calc(100dvh-17rem),48rem)] lg:overflow-y-hidden"
      style={{ gridTemplateColumns: kanbanGridColumns(LIGHTWEIGHT_VISIBLE_COLUMNS, state.collapsedColumns) }}
    >
      {LIGHTWEIGHT_VISIBLE_COLUMNS.map((column) => (
        <BoardColumn
          key={column}
          column={column}
          cards={state.grouped[column] as unknown as BoardCardItem[]}
          collapsed={Boolean(state.collapsedColumns[column])}
          onToggleCollapsed={() => state.toggleColumn(column)}
          labels={LIGHTWEIGHT_COLUMN_LABELS}
          renderCard={(card) => props.renderCard(card, state.labels, () => props.onOpenCard(card, card.id))}
          deleteAll={archivedDeleteProps({
            column,
            cards: state.grouped[column],
            filters: state,
            projects: state.data.projects as unknown as Array<{ id: string; name: string }>,
            onConfirm,
          })}
        />
      ))}
    </div>
  );
}

export function TrackPanelView(props: TrackViewProps) {
  return (
    <>
      <TrackHeader {...props} />
      {props.dialogs}
      <TrackFilters state={props.state} config={props.config} />
      {props.state.viewMode === "board" ? <BoardScrollHint /> : null}
      <TrackBoard {...props} />
    </>
  );
}

// Shared kind-driven renderers: one List and one card renderer for both
// tracks, so callers pass a kind instead of maintaining parallel
// Explore/Research shells. The kind branch lives here once — not once per
// shell file.
export function TrackListForKind(props: {
  kind: "explore" | "research";
  groups: Record<string, ListCard[]>;
  collapsed: Record<string, boolean>;
  onToggle: (column: string) => void;
  onOpenCard: (card: ListCard) => void;
  onOpenThread: (threadId: string) => void;
  labelById: ReadonlyMap<string, string>;
}) {
  const { kind, labelById, ...rest } = props;
  return (
    <TrackList
      {...rest}
      metaFor={(card) => kind === "explore"
        ? exploreListMeta(card, labelById)
        : researchListMeta(card, labelById)}
    />
  );
}

export function renderTrackCardForKind(
  kind: "explore" | "research",
  card: BoardCardItem,
  labelById: ReadonlyMap<string, string>,
  onOpen: () => void,
) {
  if (kind === "explore") {
    return (
      <LightweightTrackCard
        card={card}
        kind="explore"
        tagLabel={card.exploreStage ? (labelById.get(card.exploreStage) ?? card.exploreStage) : null}
        tagTitle="Technique — the focused approach this exploration runs."
        ariaNoun="exploration"
        onOpen={onOpen}
      />
    );
  }
  return (
    <LightweightTrackCard
      card={card}
      kind="research"
      tagLabel={joinStrategyLabels(card.researchStrategies ?? [], labelById)}
      tagTitle="Research strategy — the playbook driving this investigation."
      ariaNoun="research"
      onOpen={onOpen}
    />
  );
}
