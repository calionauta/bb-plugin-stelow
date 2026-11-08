import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { inboxQuestionRoute } from "../../lib/inbox-question-route.mjs";
import { goToInboxAsk } from "./inbox-panel-actions";
import type { InboxNotification } from "./inbox-types";

/**
 * The Inbox row's second door, gated.
 *
 * A row about a question can open the question WITHOUT the card — the ask, the
 * request's collapsed line and its options, and nothing else — because loading
 * a nine-section card to answer one question is a real tax. Whether that is
 * safe is decided in `lib/inbox-question-route.mjs`, and this is the wiring.
 *
 * It returns `null` rather than a fallback where the gate refuses, which is the
 * point: the row then offers only the click it always had, and the reader opens
 * the card and lands on the ask — the same destination, reached the one way
 * available. A refusal that opened a half-capable view instead would be the
 * failure the gate exists to prevent.
 *
 * Split out of `inbox-panel.tsx`, which was over its line budget and whose job
 * is rendering rows, not deciding where a row navigates.
 */
export function openAskDoor(
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>,
  navigate: ReturnType<typeof useBbNavigate>,
  reload: () => Promise<unknown>,
) {
  return (entry: InboxNotification): (() => void) | null => {
    // `hasDocumentViewer: true` states this host's capability: the panel can
    // open a card document (the same condition openAskArtifact needs), so the
    // evidence an option attaches is not hidden by the narrow door.
    const route = inboxQuestionRoute(entry, {
      hasDocumentViewer: true,
      hasSplitQuestion: entry.questionKind === "split",
    });
    if (route.route !== "direct") return null;
    return () => {
      // Acknowledgement is best-effort, like the row's own open: a reader who
      // chose to answer must still arrive if marking it read fails.
      if (!entry.readAt) {
        void rpc.call("markNotificationRead", { notificationId: entry.id }).catch(() => undefined);
      }
      void reload();
      goToInboxAsk(navigate, entry.cardId, entry.id);
    };
  };
}
