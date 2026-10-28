import { FiltersBar } from "../board/board-filters";
import { SelectModeToggle } from "../board/select-mode-toggle";
import { ViewToggle } from "../board/board-view-toggle";
import { INTENT_LABEL } from "../detail/card-detail-route";
import {
  BUILD_BOARD_COLUMN_LABELS,
  BUILD_BOARD_VISIBLE_COLUMNS,
} from "../../lib/workflow-vocabulary.mjs";
import type { BuildPanelState } from "./build-panel-types";

/**
 * The board's control strip: filters, the door to selection, the view toggle.
 *
 * One row by design — a reader who came to look at the board finds everything
 * that narrows or rearranges it in the same place. `SelectModeToggle` sits
 * between the two because it narrows nothing: it arms an action, and the bar it
 * arms appears at the bottom of the viewport.
 *
 * Extracted from `build-panel-view.tsx` when the select mode added its own
 * control there: the panel file was at its line budget before, and this strip is
 * a self-contained row with its own option lists.
 */
const INTENT_OPTIONS = [
  { value: "all", label: "All types" },
  ...Object.entries(INTENT_LABEL).map(([value, label]) => ({ value, label })),
];
const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  ...BUILD_BOARD_VISIBLE_COLUMNS.map((column) => ({
    value: column,
    label: BUILD_BOARD_COLUMN_LABELS[column] ?? column,
  })),
];
const ACTIVITY_OPTIONS = [
  { value: "all", label: "Any activity" },
  { value: "idle", label: "idle" },
  { value: "running", label: "running" },
  { value: "awaiting-answer", label: "awaiting-answer" },
  { value: "error", label: "error" },
];

export function BuildControlStrip({ state, onAttention }: {
  state: BuildPanelState;
  onAttention: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2 border-b pb-3">
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
      <SelectModeToggle
        active={state.selectMode}
        count={state.selectedIds.size}
        onEnter={state.enterSelectMode}
        onExit={state.exitSelectMode}
      />
      <ViewToggle
        view={state.viewMode}
        track="build"
        onChange={state.setViewMode}
        label="Build cards view"
      />
    </div>
  );
}
