import { CURRENT_STAGE_PILL_CLASS } from "../dashboard/build-status-pills";
import { PHASE_LABELS, STAGE_PRODUCES, STAGE_SEQUENCE, STAGE_SKILL, STAGE_TO_BAND, stageLabel } from "../../lib/workflow-vocabulary.mjs";

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
  if (passed) return "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300";
  if (skipReason ?? isOffRoute) return "border border-dashed border-border text-muted-foreground/70 hover:border-primary/50 hover:text-foreground";
  if (canAdvance) return "cursor-pointer border border-primary/40 text-primary hover:bg-primary/10";
  return "cursor-pointer border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground";
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
// the artifact count. Only legal advance/regress targets click through.
function StageChip({ stage, current, currentStage, terminal, legal, offRoute, skipReasonByStage, offRouteReason, artifacts, onPick }: {
  stage: string;
  current: number;
  currentStage: string;
  terminal?: "completed" | "archived";
  legal: Set<string>;
  offRoute: Set<string>;
  skipReasonByStage: Map<string, string>;
  offRouteReason: string | null;
  artifacts: Array<{ stage: string }>;
  onPick: (stage: string) => void;
}) {
  const idx = STAGE_SEQUENCE.indexOf(stage);
  const isCurrent = !terminal && stage === currentStage;
  // A completed card retains its final stage as a completion
  // record. It is not an earlier stage to reopen from the UI.
  const isTerminalCheckpoint = terminal === "completed" && stage === currentStage;
  const isOffRoute = !isCurrent && offRoute.has(stage);
  const skipReason = !isCurrent ? skipReasonByStage.get(stage) ?? null : null;
  const passed = idx >= 0 && idx < current && !isOffRoute && !skipReason;
  const canAdvance = idx === current + 1 && legal.has(stage);
  const canRegress = terminal !== "archived" && passed && !isCurrent && !isTerminalCheckpoint;
  const clickable = canAdvance || canRegress;
  const produced = artifacts.filter((artifact) => artifact.stage === stage);
  const dimmedTitle = skipReason ?? (isOffRoute ? offRouteReason ?? "Not in this workflow's route" : [STAGE_PRODUCES[stage], STAGE_SKILL[stage] ? `Defined by ${STAGE_SKILL[stage]} — see the Workflow map below for the link.` : null].filter(Boolean).join(" "));
  return (
    <span key={stage} className={`inline-flex shrink-0 items-center gap-1 ${isOffRoute ? "opacity-60" : ""}`}>
      <button
        type="button"
        disabled={!clickable || isCurrent}
        title={dimmedTitle}
        onClick={() => onPick(stage)}
        className={`disabled:cursor-not-allowed cursor-pointer relative inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${chipTone({ isCurrent, passed, skipReason, isOffRoute, canAdvance })}`}
        >
          {passed ? <span aria-hidden>✓</span> : isCurrent ? "●" : skipReason ? <span aria-hidden>⊘</span> : canAdvance ? "·" : "·"}
          <span className={isOffRoute ? "line-through" : ""}>{stageLabel(stage)}</span>
          {/* Count-only, never a control: files and navigation
              keep one shape each, and the pill stays one
              click target (advance/return). */}
          {produced.length > 0 ? <span className="text-muted-foreground">· {produced.length} file{produced.length === 1 ? "" : "s"}</span> : null}
          {canAdvance ? <span aria-hidden className="text-[9px]">→</span> : null}
      </button>
    </span>
  );
}

export function StageTimeline({ currentStage, nextStages, artifacts, onPick, skips, offRouteReason, terminal }: { currentStage: string; nextStages: string[]; artifacts: Array<{ stage: string }>; onPick: (stage: string) => void; skips: { offRoute: string[]; skipped: Array<{ stage: string; reason: string }> }; offRouteReason: string | null; terminal?: "completed" | "archived" }) {
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
        const hasAnyUpcoming = stages.some((stage) => STAGE_SEQUENCE.indexOf(stage) > current);
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
                  onPick={onPick}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
