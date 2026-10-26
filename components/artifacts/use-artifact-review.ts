import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";

/** What a row needs to draw and change its reviewed mark. */
export type ArtifactReviewMark = { reviewed: boolean; stale: boolean };

/**
 * The client half of the reviewed mark.
 *
 * The server decides the fingerprint, so the call carries a path and nothing
 * else. The mark is not optimistic: a row only changes when the server says it
 * did, and a refusal is shown in the section instead of leaving the control
 * claiming a state nobody recorded — the same rule the composer follows for a
 * comment that was saved but never sent.
 */
export function useArtifactReview(cardId: string, onReviewedChanged?: () => void) {
  const rpc = useRpc<typeof rpcContract>();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A refusal belongs to the card it was made on. The detail pane is reused
  // when the reader selects another card, so an error left standing would
  // render under a card that never refused anything — and a response landing
  // after the switch must not write into the new card either.
  const activeCard = useRef(cardId);
  useEffect(() => {
    activeCard.current = cardId;
    setError(null);
    setPendingPath(null);
  }, [cardId]);
  const toggle = useCallback(async (path: string, reviewed: boolean) => {
    const requestedFor = cardId;
    setPendingPath(path);
    setError(null);
    try {
      const result = reviewed
        ? await rpc.call("unmarkArtifactReviewed", { cardId, path })
        : await rpc.call("markArtifactReviewed", { cardId, path });
      if (activeCard.current !== requestedFor) return;
      if (!result.ok) {
        setError(result.error ?? "The host refused the mark without a reason.");
        return;
      }
      onReviewedChanged?.();
    } catch {
      if (activeCard.current !== requestedFor) return;
      setError("The host could not record the mark. Nothing changed on this card.");
    } finally {
      if (activeCard.current === requestedFor) setPendingPath(null);
    }
  }, [cardId, onReviewedChanged, rpc]);
  return { toggle, pendingPath, error };
}
