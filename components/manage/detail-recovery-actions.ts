import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";

// Failure recovery shared by the lightweight detail bodies (research,
// explore): retry the failed worker in place, and post a quality failure
// list where the worker reads it, then resume. Same rails, one track noun
// for the success toast — never a per-track copy.

export function useDetailRecoveryActions({ cardId, trackNoun, onChanged }: {
  cardId: string;
  trackNoun: string;
  onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [retrying, setRetrying] = useState(false);
  async function doRetry() {
    setRetrying(true);
    try {
      const result = await rpc.call("retryWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Retry failed. Try Restart fresh instead.");
      else toast.success(`Worker retried — continuing the ${trackNoun}.`);
      onChanged();
    } finally {
      setRetrying(false);
    }
  }

  const [repairing, setRepairing] = useState(false);
  async function doQualityRepair(lines: string[]) {
    setRepairing(true);
    try {
      const posted = await rpc.call("addCardComment", { cardId, target: "card", targetId: cardId, body: `Repair requested — the Quality section names these failures:\n${lines.map((line) => `- ${line}`).join("\n")}` });
      if (posted.error) {
        toast.error(posted.error);
        return;
      }
      const retried = await rpc.call("retryWorker", { cardId });
      if (!retried.ok) toast.error(retried.error ?? "Repair posted, but resume failed.");
      else toast.success("Repair requested — worker resumed with the failure list.");
      onChanged();
    } finally {
      setRepairing(false);
    }
  }
  return { retrying, doRetry, repairing, doQualityRepair };
}
