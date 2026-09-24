import type { ReactNode } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { INTENT_LABEL } from "../detail/card-detail-route";
import { kanbanGridColumns } from "../../lib/kanban-layout.mjs";
import { FiltersBar } from "../board/board-filters";
import { ViewToggle } from "../board/board-view-toggle";
import { BuildList } from "../board/track-lists";
import { BoardColumn } from "../board/board-column";
import { BoardCard } from "../board/board-cards";
import { FlowStrip } from "../board/flow-strip";
import { HillBoard } from "../board/hill-board";
import { BucketGalleryButton } from "../board/card-gallery";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import type { BuildPanelState } from "./build-panel-types";
import { BUILD_COLUMN_LABELS, BUILD_VISIBLE_COLUMNS } from "./build-panel-state";

const INTENT_OPTIONS = [
  { value: "all", label: "All types" },
  ...Object.entries(INTENT_LABEL).map(([value, label]) => ({ value, label })),
];
const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  ...BUILD_VISIBLE_COLUMNS.map((column) => ({
    value: column,
    label: BUILD_COLUMN_LABELS[column] ?? column,
  })),
];
const ACTIVITY_OPTIONS = [
  { value: "all", label: "Any activity" },
  { value: "idle", label: "idle" },
  { value: "running", label: "running" },
  { value: "awaiting-answer", label: "awaiting-answer" },
  { value: "error", label: "error" },
];

type Props = {
  state: BuildPanelState;
  dialogs: ReactNode;
  onNewIssue: () => void;
  onOpenPresets: () => void;
  onOpenGithub: () => void;
  onOpenCard: (card: { kind: "build" | "research" | "explore" }, cardId: string) => void;
  onOpenThread: (threadId: string) => void;
  onMoveCard: (cardId: string, target: string) => void;
};

type BuildHeaderProps = {
  attentionCount: number;
  groupedInbox: BuildPanelState["grouped"]["inbox"];
  githubAutomationEnabled: boolean;
  onNewIssue: () => void;
  onOpenCard: Props["onOpenCard"];
  onAttention: () => void;
  onOpenPresets: () => void;
  onOpenGithub: () => void;
};

function BuildHeaderIntro({ attentionCount, onAttention }: Pick<BuildHeaderProps, "attentionCount" | "onAttention">) {
  return (
    <div className="min-w-0">
      <h1 className="text-xl font-semibold tracking-tight">Build</h1>
      <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
        An AI agent carries each card through a structured workflow—from triage to
        scope-by-scope execution—pausing for your decisions wherever your review
        mode requires it.
      </p>
      {attentionCount > 0 ? (
        <button
          type="button"
          onClick={onAttention}
          className="mt-0.5 inline-flex min-h-11 cursor-pointer items-center text-xs text-amber-700 underline-offset-4 hover:underline dark:text-amber-300"
          aria-label={`Show the ${attentionCount} cards that need attention`}
        >
          {attentionCount} {attentionCount === 1 ? "item needs" : "items need"} your attention
        </button>
      ) : null}
    </div>
  );
}

function BuildHeaderActions(props: BuildHeaderProps) {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:mt-0.5 sm:flex sm:w-auto sm:items-center sm:gap-3">
      <Button className="min-h-11 w-full sm:w-auto sm:flex-none" onClick={props.onNewIssue}>
        <Icon name="Plus" className="h-4 w-4" aria-hidden />
        New issue
      </Button>
      <BucketGalleryButton
        cards={props.groupedInbox ?? []}
        onOpenCard={(card) => props.onOpenCard(card, card.id)}
      />
      <Button
        className="min-h-11 w-full sm:w-auto sm:flex-none"
        variant="outline"
        onClick={props.onOpenPresets}
        title="Manage agent presets and per-phase routing"
      >
        <Icon name="Settings" className="h-4 w-4" aria-hidden />
        Agent Presets
      </Button>
      {props.githubAutomationEnabled ? (
        <Button
          className="min-h-11 w-full sm:w-auto sm:flex-none"
          variant="outline"
          onClick={props.onOpenGithub}
          title="Import GitHub issues now or watch labels automatically"
        >
          <Icon name="Github" className="h-4 w-4" aria-hidden />
          GitHub issues
        </Button>
      ) : null}
    </div>
  );
}

function BuildHeader(props: BuildHeaderProps) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <BuildHeaderIntro attentionCount={props.attentionCount} onAttention={props.onAttention} />
      <BuildHeaderActions {...props} />
    </header>
  );
}

function GithubAuthNotice({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <div className="mb-3 flex flex-col gap-1 rounded-md border p-2 text-xs sm:flex-row sm:items-center sm:gap-2">
      <span className="text-amber-700 dark:text-amber-300">
        Import issues needs a GitHub account linked in the github plugin.
      </span>
      <a className="text-primary underline underline-offset-2" href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
        Set up GitHub auth
      </a>
    </div>
  );
}

function EmptyBuildState({ onNewIssue }: { onNewIssue: () => void }) {
  return (
    <section className="rounded-md border border-dashed bg-muted/30 p-6 text-center">
      <h2 className="text-sm font-semibold text-foreground">Product work, guided end to end</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Stelow is an opinionated product workflow for humans and AI agents. Start with
        an outcome or problem; it guides the work through framing, critique, planning,
        execution, and review.
      </p>
      <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Button onClick={onNewIssue}>Start new issue</Button>
        <UrlLink href="https://github.com/calionauta/stelow" className="text-sm font-medium text-muted-foreground underline underline-offset-4">
          Learn about Stelow <span aria-hidden="true">↗</span>
        </UrlLink>
      </div>
    </section>
  );
}

function BuildFilters({ state, onAttention }: { state: BuildPanelState; onAttention: () => void }) {
  return (
    <div className="flex items-start gap-2 border-b pb-3">
      <div className="min-w-0 flex-1">
        <FiltersBar
          projects={state.projects}
          stageOptions={[...state.stageOptions]}
          filterProjectIds={state.projectIds}
          filterStages={state.stages}
          filterIntents={state.intents}
          filterStatuses={state.statuses}
          filterActivities={state.activities}
          intentOptions={INTENT_OPTIONS}
          statusOptions={STATUS_OPTIONS}
          activityOptions={ACTIVITY_OPTIONS}
          filterAttention={state.attention}
          onProjectToggle={state.toggleProject}
          onStageToggle={state.toggleStage}
          onIntentToggle={state.toggleIntent}
          onStatusToggle={state.toggleStatus}
          onActivityToggle={state.toggleActivity}
          onAttention={onAttention}
          onReset={state.reset}
        />
      </div>
      <ViewToggle view={state.viewMode} track="build" onChange={state.setViewMode} label="Build cards view" />
    </div>
  );
}

function BuildBoardView({ state, onOpenCard, onOpenThread, onMoveCard }: Omit<Props, "dialogs" | "attentionCount" | "onNewIssue">) {
  if (state.viewMode === "list") {
    return (
      <BuildList
        groups={state.grouped}
        collapsed={state.collapsedListGroups}
        onToggle={state.toggleListGroup}
        onOpenCard={(card) => onOpenCard(card, card.id)}
        onOpenThread={onOpenThread}
      />
    );
  }
  if (state.viewMode === "hill") {
    const cards = Object.values(state.grouped).flat();
    return (
      <HillBoard
        cards={cards}
        onOpenCard={(card) => onOpenCard(card, card.id)}
      />
    );
  }
  return (
    <div
      data-testid="kanban-board"
      className="grid justify-start gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden"
      style={{ gridTemplateColumns: kanbanGridColumns(BUILD_VISIBLE_COLUMNS, state.collapsedColumns) }}
    >
      {BUILD_VISIBLE_COLUMNS.map((column) => (
        <BoardColumn
          key={column}
          column={column}
          cards={state.grouped[column]}
          collapsed={Boolean(state.collapsedColumns[column])}
          onToggleCollapsed={() => state.toggleColumn(column)}
          onDrop={(cardId) => onMoveCard(cardId, column)}
          labels={BUILD_COLUMN_LABELS}
          renderCard={(card) => <BoardCard card={card} onOpen={() => onOpenCard(card, card.id)} />}
        />
      ))}
    </div>
  );
}

export function BuildPanelView(props: Props) {
  const { state } = props;
  const attentionCount = state.data.cards.filter(
    (card) => card.needsAttention && card.status !== "archived",
  ).length;
  return (
    <>
      {dialogsWith(props)}
      <BuildHeader
        attentionCount={attentionCount}
        groupedInbox={state.grouped.inbox}
        githubAutomationEnabled={state.data.githubAutomationEnabled}
        onNewIssue={props.onNewIssue}
        onOpenPresets={props.onOpenPresets}
        onOpenGithub={props.onOpenGithub}
        onOpenCard={props.onOpenCard}
        onAttention={() => state.setAttention(true)}
      />
      <GithubAuthNotice enabled={state.githubAuthMissing} />
      <BuildFilters state={state} onAttention={() => state.setAttention(true)} />
      {state.cards.length === 0 && !state.loading ? <EmptyBuildState onNewIssue={props.onNewIssue} /> : null}
      <FlowStrip
        rpc={state.rpc}
        projectId={state.projectIds.length === 1 ? state.projectIds[0] ?? null : null}
        onOpenCard={(kind, cardId) => props.onOpenCard({ kind }, cardId)}
      />
      <BuildBoardView {...props} />
    </>
  );
}

function dialogsWith(props: Props) {
  return props.dialogs;
}
