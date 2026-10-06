import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Icon } from "@/components/ui/icon";
import type { ArchivedDeleteProps } from "./archived-delete-props";

/**
 * The Archived column's "delete all": a small ghost control beside the count,
 * and the confirmation that has to justify it.
 *
 * Both live together because the control without its confirmation is the thing
 * that must never ship, and the confirmation is where the blast radius is
 * stated — the count, the filter it applies to, and the plain statement that
 * comments, history and run files go and cannot come back, while Git checkouts
 * survive. It refuses to render at all on an empty column: a "delete all" that
 * deletes nothing is an affordance for an accident.
 *
 * Destructive actions never take the prominent slot (they live in Manage, and
 * here behind a ghost button and a modal), which is why this is `size="sm"`
 * ghost with a muted colour that turns destructive on hover rather than a filled
 * button sitting where the reader's eye lands first.
 */

function deleteDescription(count: number, filterLabel: string): string {
  return [
    `Deletes all ${count} archived ${count === 1 ? "card" : "cards"} matching "${filterLabel}".`,
    "Each card's comments, history, and Stelow run files (.stelow artifacts) are removed and cannot be recovered.",
    "Code changes in Git checkouts are kept: committed and uncommitted work survives.",
  ].join(" ");
}

export function ArchivedColumnDelete(props: ArchivedDeleteProps & { count: number }) {
  const [open, setOpen] = useState(false);
  const { count, filterLabel, onConfirm } = props;
  if (count === 0) return null;
  const noun = count === 1 ? "card" : "cards";
  const scope = `all ${count} archived ${noun} matching "${filterLabel}"`;
  return (
    <>
      {/* No wrapper of its own. It used to render a `div.mb-1.flex.justify-end` BETWEEN the
          header and the cards, which pushed this column's card stack down and left it out
          of line with every other column — reported from the live board as "the delete all
          is leaving the cards misaligned horizontally". Its parent is the header row now,
          so it takes the slot beside the count and adds no height. */}
      <Button
        variant="ghost"
        size="sm"
        className="min-h-11 cursor-pointer text-xs text-muted-foreground hover:text-destructive"
        title={`Delete ${scope}`}
        aria-label={`Delete ${scope}`}
        onClick={() => setOpen(true)}
      >
        <Icon name="Trash2" className="size-3.5" />
        Delete all
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${count} archived ${noun}?`}
        description={deleteDescription(count, filterLabel)}
        confirmLabel={`Delete ${count}`}
        confirmTone="destructive"
        onConfirm={async () => {
          // Stay open until the work is done. `ConfirmActionDialog` shows
          // "Working…" and disables both buttons while this awaits — which is
          // the only thing standing between the reader and a second click over
          // a stale id list. Closing first (as the single-card delete does) is
          // fine for one card and wrong for a column of hundreds: stopping
          // workers and removing run files takes long enough that silence reads
          // as a hang, and a closed dialog cannot show progress.
          await onConfirm(props.cardIds);
          setOpen(false);
        }}
      />
    </>
  );
}
