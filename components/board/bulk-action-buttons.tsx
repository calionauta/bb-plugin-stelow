import { Button } from "@/components/ui/button";

type BulkVerb = "start" | "archive" | "delete";

/**
 * The bar's buttons: one per bulk verb, plus the two that move selection itself.
 *
 * Split out of `build-bulk-bar.tsx` when the select mode added its own controls:
 * the bar file was at its line budget before, and a bar whose row of buttons is
 * unreadable is the one part of it a reader actually sees.
 *
 * Labels carry live counts, so a verb with nothing eligible says `Start (0)` and
 * is disabled rather than erroring after the click. `Select all` names the same
 * reach the confirm dialogs name — the cards the filters left on the board — and
 * `Done` is the exit: leaving select mode has to be a visible control, because
 * outside the mode there is no mark and, with nothing selected, no other way
 * back.
 */
export function BulkActionButtons({
  count,
  present,
  pending,
  startEligible,
  archiveEligible,
  deleteEligible,
  onStart,
  onArchive,
  onDelete,
  onSelectAll,
  onClear,
  onExit,
}: {
  count: number;
  present: number;
  pending: BulkVerb | null;
  startEligible: number;
  archiveEligible: number;
  deleteEligible: number;
  onStart: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onExit: () => void;
}) {
  // Selection by hand was the only way in, and the control paid for it on every
  // tile all the time. `Select all` is disabled when there is nothing further to
  // add, and says so with the count it already reached.
  const allSelected = present > 0 && count >= present;
  return (
    <>
      <span className="text-sm font-medium tabular-nums">{count} selected</span>
      <BarButton
        label={allSelected ? `All ${present}` : `Select all (${present})`}
        disabled={allSelected}
        onClick={onSelectAll}
      />
      <BulkVerbButtons {...{ pending, startEligible, archiveEligible, deleteEligible, onStart, onArchive, onDelete }} />
      <BarButton label="Clear" tone="ghost" disabled={count === 0} onClick={onClear} />
      <BarButton label="Done" tone="ghost" onClick={onExit} />
    </>
  );
}

/**
 * The three verbs that change cards, as opposed to the three that change the
 * selection. Split from the row above because they share a shape the other three
 * do not: a live count in the label, a busy word, and disabled when nothing is
 * eligible rather than erroring after the click.
 */
function BulkVerbButtons({ pending, startEligible, archiveEligible, deleteEligible, onStart, onArchive, onDelete }: {
  pending: BulkVerb | null;
  startEligible: number;
  archiveEligible: number;
  deleteEligible: number;
  onStart: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <BarButton
        label={`Start (${startEligible})`}
        busy={pending === "start"}
        busyLabel="Starting..."
        disabled={startEligible === 0}
        onClick={onStart}
      />
      <BarButton
        label={`Archive (${archiveEligible})`}
        busy={pending === "archive"}
        busyLabel="Archiving..."
        disabled={archiveEligible === 0}
        onClick={onArchive}
      />
      <BarButton
        label={`Delete (${deleteEligible})`}
        busy={pending === "delete"}
        busyLabel="Deleting..."
        tone="destructive"
        disabled={deleteEligible === 0}
        onClick={onDelete}
      />
    </>
  );
}

/**
 * One button shape, so the five verbs cannot drift apart a class at a time.
 *
 * Each verb used to spell out the same four classes; the difference between them
 * is its tone, its label, and whether it is running - which is exactly what this
 * takes as arguments and nothing else.
 */
type BarButtonProps = {
  label: string;
  busy?: boolean;
  busyLabel?: string;
  tone?: "outline" | "destructive" | "ghost";
  disabled?: boolean;
  onClick: () => void;
};

function BarButton({ label, busy, busyLabel, tone = "outline", disabled = false, onClick }: BarButtonProps) {
  return (
    <Button
      variant={tone}
      className="min-h-11 cursor-pointer"
      disabled={disabled || busy === true}
      onClick={onClick}
    >
      {busy ? busyLabel : label}
    </Button>
  );
}
