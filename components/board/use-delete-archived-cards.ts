import { useCallback } from "react";
import { toast } from "sonner";
import { deleteInBatches } from "../../lib/bulk-delete-batch.mjs";
import { describeBulkDelete } from "../../lib/bulk-delete-outcome.mjs";

/**
 * The Archived column's "delete all", wired to the RPC and reported honestly.
 *
 * The result is per card on purpose — see `describeBulkDelete` for why a
 * partial success has to read as partial. This hook is only the call and the
 * toast; the wording is a lib function and the batching is another, so both are
 * tested without a DOM.
 *
 * Batching matters because the RPC caps a call at 200 ids as a request-size
 * guard, and a column can hold more than that. Without it, 201 archived cards
 * answered `HTTP 400: rpc input validation failed` under a dialog that had just
 * promised "Deletes all 201 archived cards" — nothing deleted, nothing
 * explained.
 *
 * There is no trailing "undo", and no system log the record can live in once
 * the cards are gone: a per-card trail comment dies with the card, exactly as
 * it does for the single-card delete. The toast is therefore the account of
 * what happened, and it carries the evidence — how many went, and the reason
 * for each that stayed.
 */

type DeleteResult = {
  deleted: string[];
  failed: { cardId: string; error: string }[];
};

type Rpc = {
  call: (
    method: "deleteArchivedCards",
    input: { cardIds: string[] },
  ) => Promise<DeleteResult>;
};

export function useDeleteArchivedCards(rpc: Rpc) {
  return useCallback(
    async (cardIds: string[]) => {
      try {
        const result = await deleteInBatches(
          (batch) => rpc.call("deleteArchivedCards", { cardIds: batch }),
          cardIds,
        );
        const { message, tone } = describeBulkDelete(result, cardIds.length);
        if (tone === "success") toast.success(message);
        else toast.error(message);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed.");
      }
    },
    [rpc],
  );
}
