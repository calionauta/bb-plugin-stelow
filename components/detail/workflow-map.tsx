import { UrlLink } from "@get-bb/plugin-sdk/app";
import { DisclosureSection } from "../disclosure";
import { STAGE_SEQUENCE, STAGE_TO_BAND, WORKFLOW_PHASES, stageInfoUrl, stageLabel } from "../../lib/workflow-vocabulary.mjs";
import { stageSummary } from "../../lib/stage-vocabulary-surfaces.mjs";

// Workflow map: what each stage does, grouped by phase, each linked to
// the upstream skill or behavior document that defines it. A sibling of
// the progress section (never nested inside it) so it inherits the card's
// section rhythm instead of stacking its own offset.

const STAGE_BAND = STAGE_TO_BAND;

// One phase section: its stages with numbers, labels, skill links, and
// what each stage produces.
function WorkflowPhaseSection({ phase }: { phase: { id: string; label: string } }) {
  const stages = STAGE_SEQUENCE.filter((stage) => STAGE_BAND[stage] === phase.id);
  return (
    <section key={phase.id} aria-labelledby={`workflow-map-${phase.id}`} className="space-y-2.5">
      <div className="flex items-center gap-2">
        <h5 id={`workflow-map-${phase.id}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{phase.label}</h5>
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">{stages.length} {stages.length === 1 ? "stage" : "stages"}</span>
      </div>
      <ul className="grid gap-2.5 lg:grid-cols-2">
        {stages.map((stage) => {
          const url = stageInfoUrl(stage);
          // One derived answer per stage, not a second reading of the catalog.
          const summary = stageSummary(stage);
          const skill = summary?.attribution?.skill ?? null;
          return (
            <li key={stage} className="flex min-w-0 gap-2.5 rounded-md border bg-muted/30 px-3 py-2.5">
              <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-muted-foreground ring-1 ring-border">{STAGE_SEQUENCE.indexOf(stage) + 1}</span>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium leading-5 text-foreground">{stageLabel(stage)}</span>
                  {url && skill ? (
                    <UrlLink href={url} title={`How ${stageLabel(stage)} works — ${skill} on GitHub`} aria-label={`${stageLabel(stage)} stage definition in ${skill} on GitHub`} className="text-xs leading-5 text-primary underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      {skill}
                    </UrlLink>
                  ) : null}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{summary?.produces}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WorkflowMap({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  return (
    // The one shared disclosure, not a second hand-rolled <details>. This section
    // had its own summary markup, its own chevron call and its own background,
    // so it was the one sibling on the card that did not match the others — and a
    // reader reads shape before words. DisclosureSection is the shape; the
    // content below is what this section was the only one able to say.
    <DisclosureSection title="Workflow map" subtitle="what each stage does" open={open} onToggle={onToggle}>
      <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
        Analysis, Planning, Execution, and Review are workflow phases. Review contains
        automated checks (Code Review and Audit), not human review. Done is the completed
        outcome after Audit, not a stage; Needs attention can occur in any phase. Each
        stage links to the upstream Stelow skill or behavior document that defines it.
      </p>
      <div className="space-y-4">
        {WORKFLOW_PHASES.map((phase) => (
          <WorkflowPhaseSection key={phase.id} phase={phase} />
        ))}
      </div>
    </DisclosureSection>
  );
}
