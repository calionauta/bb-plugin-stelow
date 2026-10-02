import { Button } from "@/components/ui/button";
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
      </span>
    </div>
  );
}
