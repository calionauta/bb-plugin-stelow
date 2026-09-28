import type { BatchItem, QuestionBoundaryShape } from "./batch-types";

// A boundary question's own frame, separate from the stepper shell so the
// heading and the notice are decided in one place. `showOptions` is the
// difference that matters: a `reaction` boundary is recorded before the agent
// has synthesised anything, so there is nothing to pick between yet, and an
// option list rendered under it would replace the reader's first reaction with
// the agent's framing — the inversion the Interface Contrast method exists to
// prevent.
export function BoundaryQuestionFrame({ boundary }: { boundary: QuestionBoundaryShape }) {
  return (
    <>
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{boundary.heading}</p>
      {boundary.notice
        ? (
          <p
            role="note"
            className="rounded-md border border-amber-500/30 bg-background/50 p-2 text-xs leading-5 text-amber-900/80 dark:text-amber-100/80"
          >
            {boundary.notice}
          </p>
        )
        : null}
    </>
  );
}

/** The options a boundary question is allowed to show, as decided server-side. */
export function boundaryOptions(item: BatchItem) {
  if (!item.boundary) return item.options;
  return item.boundary.showOptions ? item.options : [];
}
