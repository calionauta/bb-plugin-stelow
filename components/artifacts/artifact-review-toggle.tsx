import { Button } from "@/components/ui/button";
import type { ArtifactReviewMark } from "./use-artifact-review";

/**
 * The reviewed marks a set of rows draws, and the one action that changes them.
 *
 * `marks` is keyed by artifact path and only carries paths the server reports
 * as this card's artifacts, so a row with no mark gets no toggle rather than a
 * button whose only outcome is a refusal.
 */
export type ArtifactReviewControls = {
  marks: ReadonlyMap<string, ArtifactReviewMark>;
  pendingPath: string | null;
  onToggle: (path: string, reviewed: boolean) => void;
};

/** The toggle's label. Stale is not "reviewed": the mark exists, but it names
 * a version the card no longer shows, so the honest next action is to look and
 * mark again. */
function reviewLabel(mark: ArtifactReviewMark, pending: boolean): string {
  if (pending) return "Saving…";
  if (mark.reviewed) return "Reviewed";
  if (mark.stale) return "Review again";
  return "Mark reviewed";
}

/**
 * The mark's controls, extracted so the row stays a row and the button stays a
 * Button (the raw-button count in AGENTS.md is measured, not a habit).
 *
 * A stale mark gets a second, quiet Clear control: "Review again" is the common
 * action, but the reversible pair must be reachable for the rows that most need
 * it, not only for fresh marks.
 */
export function ReviewToggle({ display, path, mark, pending, onToggle }: {
  display: string;
  path: string;
  mark: ArtifactReviewMark;
  pending: boolean;
  onToggle: (path: string, reviewed: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-start">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={mark.reviewed}
        aria-label={`${reviewLabel(mark, pending)}: ${display}`}
        disabled={pending}
        title={mark.reviewed
          ? "Clear the reviewed mark for this artifact"
          : mark.stale
            ? "This artifact changed after it was marked reviewed. Open it, then mark it again."
            : "Mark this artifact reviewed at its current version"}
        onClick={() => onToggle(path, mark.reviewed)}
        className="my-1 min-h-11 px-2"
      >
        {reviewLabel(mark, pending)}
      </Button>
      {mark.stale && !pending ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Clear the stale reviewed mark: ${display}`}
          onClick={() => onToggle(path, true)}
          className="my-1 min-h-11 px-2 text-muted-foreground"
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}
