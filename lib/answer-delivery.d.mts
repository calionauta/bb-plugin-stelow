import type { HostHold } from "./host-hold.mjs";

/** The three ways a resume can end. `null` is the absence of a verdict. */
export type AnswerDelivery = "sent" | "queued" | "refused";

export type AnswerDispatch = {
  delivery: AnswerDelivery;
  hold?: HostHold | null;
  error?: string;
};

export type AnswerDeliveryVerdict = {
  delivery: AnswerDelivery | null;
  hold: HostHold | null;
  error: string | null;
};

export declare const ANSWER_DELIVERIES: readonly AnswerDelivery[];

export declare function answerDeliveryOf(
  dispatch: AnswerDispatch | null | undefined,
): AnswerDeliveryVerdict;

export declare function answerDeliveryCardPatch(
  verdict: { delivery: string | null } | null | undefined,
  lastOutput: string | null,
  waiting?: boolean,
): { activity: "held"; last_assistant_text: string | null } | { activity: "idle" } | null;

export declare function answerDeliveryLine(verdict: AnswerDeliveryVerdict): string | null;
