import { CURRENT_STAGE_PILL_CLASS } from "../dashboard/build-status-pills";
import { PHASE_LABELS, STAGE_SEQUENCE, STAGE_TO_BAND, stageLabel } from "../../lib/workflow-vocabulary.mjs";
import { stageSummary } from "../../lib/stage-vocabulary-surfaces.mjs";

// Timeline of the 17 workflow stages, grouped by phase (band). Each stage is a
// chip: passed / current / upcoming. Clicking an allowed target advances or
// regresses ONE stage — the timeline is the position context AND the advance
// control, so the user always sees where the card is and what it can move to.
const STAGE_BAND = STAGE_TO_BAND;

// Band display names: the vocabulary phases plus the track bands. Single
// source — the panel reads it from here too.
export const BAND_LABEL: Record<string, string> = { ...PHASE_LABELS, research: "Research", explore: "Explore" };

// Chip tone: current pulses, passed reads done, skipped/off-route dash,
// advance invites, the rest wait quietly.
function chipTone({ isCurrent, passed, skipReason, isOffRoute, canAdvance }: {
  isCurrent: boolean;
  passed: boolean;
  skipReason: string | null;
  isOffRoute: boolean;
  canAdvance: boolean;
}): string {
  if (isCurrent) return CURRENT_STAGE_PILL_CLASS;
  if (passed) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (skipReason ?? isOffRoute) return "border border-dashed border-border text-muted-foreground/70";
  if (canAdvance) return "border border-primary/40 text-primary";
  return "border border-dashed border-border text-muted-foreground";
}

// Group consecutive stages by band for the banded rows.
function groupStagesByBand(): Map<string, string[]> {
  const bands = new Map<string, string[]>();
  for (const stage of STAGE_SEQUENCE) {
    const band = STAGE_BAND[stage] ?? "other";
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band)!.push(stage);
  }
  return bands;
}

// One stage chip: passed, current, upcoming, off-route, or skipped — with
// the artifact count. Inert by design: the workflow is the agent's to drive, and a
// person who wants a different stage asks it in the conversation.
function StageChip({ stage, current, currentStage, terminal, legal, offRoute, skipReasonByStage, offRouteReason, artifacts }: {
  stage: string;
  current: number;
  currentStage: string;
  terminal?: "completed" | "archived";
  legal: Set<string>;
  offRoute: Set<string>;
  skipReasonByStage: Map<string, string>;
  offRouteReason: string | null;
  artifacts: Array<{ stage: string }>;
}) {
  const idx = STAGE_SEQUENCE.indexOf(stage);
  const isCurrent = !terminal && stage === currentStage;
  const isOffRoute = !isCurrent && offRoute.has(stage);
  const skipReason = !isCurrent ? skipReasonByStage.get(stage) ?? null : null;
  const passed = idx >= 0 && idx < current && !isOffRoute && !skipReason;
  const canAdvance = idx === current + 1 && legal.has(stage);
  const produced = artifacts.filter((artifact) => artifact.stage === stage);
  // A chip can show a sentence but not a link, so it says what the stage
  // produces and stops there. It used to append "see the Workflow map below
  // for the link" — a pointer to a component it cannot vouch for, which is
  // what let two surfaces answer the same question in two different ways.
  const dimmedTitle = skipReason ?? (isOffRoute ? offRouteReason ?? "Not in this workflow's route" : stageSummary(stage)?.text ?? "");
  // Inert, deliberately. The chip used to be a button that moved the card — a click
  // target for advancing or regressing a stage — and the workflow is not the human's to
  // drive that way: the agent advances on its own, and a person who wants a different
  // stage asks the agent in the conversation. Keeping the affordance made the board look
  // like a drag-and-drop tool, which is the opposite of what it is.
  //
  // The states still read: current is filled, passed carries a check, a skipped stage
  // shows a ⊘ and its reason, and an off-route stage is struck through. What is gone is
  // the pointer and the click handler, not the information.
  return (
    <span key={stage} className={`inline-flex shrink-0 items-center gap-1 ${isOffRoute ? "opacity-60" : ""}`}>
      <span
        title={dimmedTitle}
        className={stageChip({ isCurrent, passed, skipReason, isOffRoute, canAdvance })}
        >
          {passed ? <span aria-hidden>✓</span> : isCurrent ? "●" : skipReason ? <span aria-hidden>⊘</span> : canAdvance ? "·" : "·"}
          <span className={isOffRoute ? "line-through" : ""}>{stageLabel(stage)}</span>
          {/* Count-only, never a control: files and navigation keep one shape each. */}
          {produced.length > 0 ? <span className="text-muted-foreground">· {produced.length} file{produced.length === 1 ? "" : "s"}</span> : null}
      </span>
    </span>
  );
}

/** The timeline's inputs, named so the signature reads as one line and the component
 * stays inside the repository's function budget. */
type StageTimelineProps = {
  currentStage: string;
  nextStages: string[];
  artifacts: Array<{ stage: string }>;
  skips: { offRoute: string[]; skipped: Array<{ stage: string; reason: string }> };
  offRouteReason: string | null;
  terminal?: "completed" | "archived";
};

export function StageTimeline({ currentStage, nextStages, artifacts, skips, offRouteReason, terminal }: StageTimelineProps) {
  const curIdx = STAGE_SEQUENCE.indexOf(currentStage);
  // A finished card has no current stage: park the cursor past the end so
  // every reached stage reads as passed and nothing stays lit (or pulsing)
  // as if work were still there. Earlier completed stages remain revisit-able;
  // the terminal checkpoint and every archived stage are intentionally inert.
  const current = terminal ? STAGE_SEQUENCE.length : curIdx >= 0 ? curIdx : 0;
  const legal = new Set(nextStages.filter((stage) => stage && !stage.includes("(")));
  const offRoute = new Set(skips.offRoute);
  const skipReasonByStage = new Map(skips.skipped.map((entry) => [entry.stage, entry.reason]));
  const bands = groupStagesByBand();
  return (
    <div className="space-y-3">
      {Array.from(bands.entries()).map(([band, stages]) => {
        const bandActive = stages.some((stage) => stage === currentStage);
        const hasAnyPassed = stages.some((stage) => STAGE_SEQUENCE.indexOf(stage) < current);
        return (
          <div key={band}>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{BAND_LABEL[band] ?? band}</span>
              <span className={`h-px flex-1 ${bandActive ? "bg-primary/40" : hasAnyPassed ? "bg-emerald-500/30" : "bg-border"}`} />
            </div>
            <div className="flex gap-1 overflow-x-auto pb-0.5 md:flex-wrap md:overflow-visible">
              {stages.map((stage) => (
                <StageChip
                  key={stage}
                  stage={stage}
                  current={current}
                  currentStage={currentStage}
                  terminal={terminal}
                  legal={legal}
                  offRoute={offRoute}
                  skipReasonByStage={skipReasonByStage}
                  offRouteReason={offRouteReason}
                  artifacts={artifacts}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The stage chip's classes.
 *
 * Named because the class list outgrew the line it lived on, and because the
 * size is part of what it asserts: the chip renders at `text-xs`, the smallest
 * step still on the scale. It was `text-[11px]`, which made the number naming
 * the stage smaller than the sentence beside it.
 *
 * `min-h-8` stays: it passes WCAG 2.5.8 AA and this repo's other controls honour
 * `min-h-11`, but raising a touch target is a change to every stage chip's hit
 * area and belongs to the card that owns the rule, not to a type migration.
 */
function stageChip({ isCurrent, passed, skipReason, isOffRoute, canAdvance }: {
  isCurrent: boolean;
  passed: boolean;
  skipReason: string | null;
  isOffRoute: boolean;
  canAdvance: boolean;
}) {
  return [
    "relative inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
    "transition-colors",
    "min-h-8",
    chipTone({ isCurrent, passed, skipReason, isOffRoute, canAdvance }),
  ].filter(Boolean).join(" ");
}
