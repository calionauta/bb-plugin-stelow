import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { unmergedPrNumber } from "../../lib/card-acceptance.mjs";
import { useAcceptanceAction } from "./use-acceptance-action";

/**
 * The human disposition of a finished result.
 *
 * Sits under the hero actions rather than inside them: acceptance is not a
 * recovery and not a decision the card is blocked on — it is a receipt a person
 * may add to a card that is already Done, and it never gates anything. So it
 * gets its own row, separated by a rule, on every card kind that can finish.
 *
 * A card that carries a receipt says so and stops offering the button: a second
 * acceptance would silently rewrite when the first one was written, which is the
 * same reason `approveScopeMap` refuses a second approval.
 *
 * The line is derived server-side (`lib/card-acceptance.mjs`), so the card, the
 * trail comment, and any future surface cannot describe the receipt three
 * different ways.
 */
export function AcceptanceRow({
  cardId,
  status,
  acceptanceLine,
  onChanged,
}: {
  cardId: string;
  status: string;
  acceptanceLine: string | null | undefined;
  onChanged: () => void | Promise<void>;
}) {
  const acceptance = useAcceptanceAction(cardId, onChanged);
  // A Done card can carry both a review receipt and an unmerged pull request
  // with nothing linking the two halves — approving then reads as finishing.
  // Asked lazily, only while the button is still offered: after acceptance
  // the row is a stamp, and Publication below owns the PR state.
  const unmergedPr = useUnmergedPrNumber(cardId, status === "completed" && !acceptanceLine);

  if (acceptanceLine) {
    return (
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span className="font-medium text-emerald-700 dark:text-emerald-300">
          Accepted
        </span>
        <span>{acceptanceLine}</span>
      </p>
    );
  }
  if (status !== "completed") return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
      <Button
        size="sm"
        variant="outline"
        disabled={acceptance.accepting}
        onClick={() => void acceptance.doAccept()}
        title="Record that you accepted this finished result. A receipt, not a gate: nothing moves and nothing is unblocked."
      >
        {acceptance.accepting ? "Recording…" : "Accept result"}
      </Button>
      <span className="text-xs text-muted-foreground">
        Optional. Records your disposition on the card; it never blocks the workflow.
        {unmergedPr != null ? ` PR #${unmergedPr} still needs merging in Publication below — this only records your review.` : null}
      </span>
    </div>
  );
}

/**
 * The number of the card's still-open pull request, or null. Null covers
 * every non-answer — merged, closed, no PR, no workspace, failed read —
 * because the note is advisory: a missing cross-reference is a missing
 * sentence, never an error on the receipt.
 */
function useUnmergedPrNumber(cardId: string, enabled: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [prNumber, setPrNumber] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    rpc.call("publicationStatus", { cardId })
      .then((publication) => {
        if (!live) return;
        setPrNumber(unmergedPrNumber(publication));
      })
      .catch(() => { if (live) setPrNumber(null); });
    return () => { live = false; };
  }, [rpc, cardId, enabled]);
  return prNumber;
}
