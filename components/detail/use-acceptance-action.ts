import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";

/**
 * Recording a human acceptance on a finished card.
 *
 * Shared by all three card kinds' heroes rather than owned by the Build one:
 * acceptance is a fact about a finished result, and Research and Explore cards
 * finish too. The host owns the refusal (lib/card-acceptance.mjs), so this
 * reports whatever it says instead of re-deciding which card may be accepted —
 * two copies of that rule is how a button appears on a card the host refuses.
 *
 * It never routes to the worker. The card is Done and its worker has finished;
 * waking it would turn a disposition into new work.
 */
export function useAcceptanceAction(cardId: string, onChanged: () => void | Promise<void>) {
  const rpc = useRpc<typeof rpcContract>();
  const [accepting, setAccepting] = useState(false);

  async function doAccept() {
    setAccepting(true);
    try {
      const result = await rpc.call("acceptCard", { cardId });
      if (!result.ok) {
        toast.error(result.error ?? "The acceptance could not be recorded.");
        return;
      }
      toast.success("Acceptance recorded.");
      await onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The acceptance could not be recorded.",
      );
    } finally {
      setAccepting(false);
    }
  }

  return { accepting, doAccept };
}
