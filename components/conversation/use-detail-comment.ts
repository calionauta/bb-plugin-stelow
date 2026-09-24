import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";

export function useDetailComment({ cardId, onChanged }: {
  cardId: string;
  onChanged: () => void | Promise<void>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [comment, setComment] = useState("");

  async function submitComment() {
    const body = comment.trim();
    if (!body) return;
    const result = await rpc.call("addCardComment", { cardId, target: "card", targetId: cardId, body });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setComment("");
    await onChanged();
  }

  return { comment, setComment, submitComment };
}
