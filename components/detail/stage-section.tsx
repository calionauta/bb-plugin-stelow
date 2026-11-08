import { DisclosureSection } from "../disclosure";
import { TEXT_META, TEXT_SECTION } from "../../lib/design-tokens";
import { STAGE_SEQUENCE, STAGE_TO_BAND, WORKFLOW_PHASES, stageLabel } from "../../lib/workflow-vocabulary.mjs";
import { stageSummary } from "../../lib/stage-vocabulary-surfaces.mjs";
import { ExecutionRunsSection } from "./execution-runs-section";
import { StageTimeline } from "./stage-timeline";
import type { BuildCard, BuildDetail } from "./build-progress";
import type { useExecutionRuns } from "./use-execution-runs";

/**
 * One section for the card's stage: where it is, what that stage produces, and
 * what ran while it was there.
 *
 * These were three sibling sections. A reader asking "where is this card and
 * what is it doing" had to hold three scroll positions and reconcile three
 * headings to answer one question — which is why the card read as three
 * separate things explaining stages. The stage is one thing; the three were
 * three renderings of it. The stage-vocabulary projection already made them
 * share one answer (lib/stage-vocabulary-surfaces.mjs); what was left was the
 * structure, so this is structure: one section, three named regions.
 *
 * The stage reference stays behind its own disclosure, inside this section.
 * It is seventeen entries answering "what does stage 9 do", which is a
 * different question from "where am I" — and burying it would lose the one
 * place a reader can look up a stage they are not currently on. It is last,
 * because it is consulted least while a card is being worked.
 */

type Runs = ReturnType<typeof useExecutionRuns>;

type StageSectionProps = {
  card: BuildCard;
  detail: BuildDetail;
  runs: Runs;
  focusRunId: string | null;
  intentLabels: Record<string, string>;
  mapOpen: boolean;
  onMapToggle: (open: boolean) => void;
};

export function StageSection({
  card,
  detail,
  runs,
  focusRunId,
  intentLabels,
  mapOpen,
  onMapToggle,
}: StageSectionProps) {
  const terminal = card.status === "completed" ? "completed" : card.status === "archived" ? "archived" : undefined;
  const offRoute = card.intent && card.intent !== "unknown"
    ? `Not in this ${intentLabels[card.intent] ?? card.intent} route`
    : null;
  return (
    <section className="space-y-3" aria-label="Stage">
      <StageRegion title="Where this card is" hint={card.stage ? stageLabel(card.stage) : "not yet started"}>
        <StageTimeline
          currentStage={card.stage}
          terminal={terminal}
          nextStages={detail.nextStages}
          artifacts={detail.artifacts}
          skips={detail.stageSkips ?? { offRoute: [], skipped: [] }}
          offRouteReason={offRoute}
        />
        {card.status === "archived" ? null : (
          <p className={TEXT_META}>
            {card.status === "completed"
              ? "Workflow complete — choose an earlier stage to reopen it"
              : "The agent advances on its own — ask it in the conversation to change stage"}
          </p>
        )}
      </StageRegion>
      <ExecutionRunsSection
        card={card}
        runs={runs.runs}
        focusRunId={focusRunId}
        stoppingRunId={runs.stoppingRunId}
        retryingRunId={runs.retryingRunId}
        blockingRunId={detail.card.blockingRun?.id ?? null}
        onCancel={runs.cancel}
        onRetry={runs.retry}
      />
      <StageReference open={mapOpen} onToggle={onMapToggle} />
    </section>
  );
}

/**
 * A region of the stage section.
 *
 * A heading, not a border: `SECTION_SURFACE` is reserved for card-level
 * sections and `card-surface-consistency.test.mjs` deliberately excludes nested
 * content, so a nested box would be the "eight different shapes" defect
 * returning one level down. These regions are named, not boxed.
 */
function StageRegion({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className={TEXT_SECTION}>{title}</h3>
        {hint ? <span className={TEXT_META}>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Every stage, grouped by phase, with what it produces and what defines it.
 *
 * `stageSummary` is the same projection the timeline chip reads, so the
 * sentence a reader sees here and the sentence they get on a chip cannot
 * drift — which is the defect that produced this merge.
 */
function StageReference({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <DisclosureSection
      title="Stage reference"
      subtitle="what each of the 17 stages produces, and what defines it"
      open={open}
      onToggle={onToggle}
    >
      <div className="space-y-3">
        {WORKFLOW_PHASES.map((phase) => {
          const stages = STAGE_SEQUENCE.filter((stage) => STAGE_TO_BAND[stage] === phase.id);
          return (
            <div key={phase.id} className="space-y-1.5">
              <h4 className={TEXT_SECTION}>{phase.label}</h4>
              <ul className="grid gap-2 lg:grid-cols-2">
                {stages.map((stage) => <StageRow key={stage} stage={stage} />)}
              </ul>
            </div>
          );
        })}
      </div>
    </DisclosureSection>
  );
}

/**
 * The stage index badge.
 *
 * A stage marker, not body copy: it is a numeral in a circle, so it carries the
 * smallest named step on the scale. It was `text-[11px]` — a size no longer on
 * the scale and only available as a recorded exception — which made a stage
 * number smaller than the sentence describing the stage beside it.
 */
const STAGE_INDEX_BADGE =
  "flex size-6 shrink-0 items-center justify-center rounded-full bg-background "
  + "text-xs font-semibold text-muted-foreground ring-1 ring-border";

function StageRow({ stage }: { stage: string }) {
  const summary = stageSummary(stage);
  return (
    <li className="flex min-w-0 gap-2.5 rounded-md border bg-muted/30 px-3 py-2.5">
      <span aria-hidden className={STAGE_INDEX_BADGE}>
        {STAGE_SEQUENCE.indexOf(stage) + 1}
      </span>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium leading-5 text-foreground">{stageLabel(stage)}</span>
          {summary?.attribution?.url && summary.attribution.skill ? (
            <a
              href={summary.attribution.url}
              title={`How ${stageLabel(stage)} works — ${summary.attribution.skill} on GitHub`}
              className="text-xs leading-5 text-primary underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              {summary.attribution.skill}
            </a>
          ) : null}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{summary?.produces}</p>
      </div>
    </li>
  );
}
