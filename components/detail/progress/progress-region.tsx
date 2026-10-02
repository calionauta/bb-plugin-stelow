import type { ReactNode } from "react";
import { TEXT_SECTION } from "../../../lib/design-tokens";

/**
 * One region of the workflow-progress disclosure.
 *
 * The disclosure used to hold six unrelated regions — scope sync, card checks,
 * file contention, the scope map, scope progress, the stage timeline, and the
 * files named in the request — stacked under one "Workflow progress" heading
 * with nothing between them. A reader could not tell file contention from
 * scope progress without reading both, and the section's own subtitle ("where
 * this card is") described only one of the seven things inside it.
 *
 * A region gets a heading, not a border. `SECTION_SURFACE` is reserved for
 * things that are sections on the card; these are regions inside one section,
 * and `card-surface-consistency.test.mjs` deliberately excludes nested content
 * for that reason. Differing by tone, never by a new border, is the rule the
 * card already follows.
 */
export function ProgressRegion({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-3" aria-label={title}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className={TEXT_SECTION}>{title}</h4>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}
