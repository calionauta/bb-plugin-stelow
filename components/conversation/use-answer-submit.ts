/**
 * Submitting an answer batch: one call, one door, and the wake's verdict.
 *
 * Extracted from `QuestionBatch` when that component went over its function
 * budget. The behaviour is the door's, not the form's: the stepper only has to
 * hand over the picks.
 *
 * The two doors commit the answers and wake the worker as two separate acts,
 * and both report what the waking did. A queued or refused wake used to be
 * indistinguishable from a resume here — the door returned one boolean — so the
 * reader navigated away believing a paused worker had been woken. A dispatched
 * resume returns no line and speaks for itself; anything else is a fact the
 * reader has to be told before the card disappears from the Inbox.
 */
import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { expiredAnswerPayload } from "../../lib/question-store.mjs";
import type { BatchItem } from "./batch-types";

export function useAnswerSubmit(
  cardId: string,
  questions: BatchItem[],
  mode: "live" | "expired",
  onAnswered: () => void,
) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(all: string[][]) {
    setBusy(true); setError(null);
    try {
      let deliveryLine: string | null = null;
      if (mode === "live") {
        const result = await rpc.call("answerQuestions", {
          cardId,
          answers: questions.map((q, i) => ({ questionId: q.id, answers: all[i] ?? [] })),
        });
        if (!result.ok) { setError(result.error ?? "Could not send the answers."); return; }
        deliveryLine = result.deliveryLine;
      } else {
        // Timed-out questions retain every selected option. The batch stays
        // atomic, so a later answer cannot revise work already resumed.
        const payload = expiredAnswerPayload(questions, all);
        if (payload.length === 0) return;
        const result = await rpc.call("answerExpiredQuestions", { cardId, answers: payload });
        if (!result.ok) { setError(result.error ?? "Could not send the answers."); return; }
        deliveryLine = result.deliveryLine;
      }
      if (deliveryLine) toast.message(deliveryLine);
      onAnswered();
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, submit };
}
