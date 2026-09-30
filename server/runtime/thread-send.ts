import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostHold, type HostHold } from "../../lib/host-hold.mjs";
import type { WorkerCard } from "../workers-types.js";

type ThreadInput = Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0]["input"];

/**
 * What a send to a worker thread actually did.
 *
 * `sent` is the only outcome that means the worker is running. The host
 * answers a dispatch with a discriminated union — `{delivery:"sent"}` or
 * `{delivery:"queued", queuedMessage}` — and this function used to collapse
 * both into `true`, because the call had not thrown. That one word is the whole
 * bug: a message the host decided to hold was reported as a successful resume,
 * so the card went `running` and spent an auto-continue from its budget for a
 * turn that would not start until a slot freed. Ten ticks of it, ten queued
 * nudges, budget gone, and a card telling the reader it was paused and needed
 * a Resume.
 *
 * So the verdict travels with the evidence: a queued delivery carries the hold
 * it is sitting in, read from the row the host just handed back, so the card
 * can project the truth the moment it is told rather than on the next tick.
 */
export type AgentDispatch =
  | { delivery: "sent" }
  | { delivery: "queued"; hold: HostHold }
  | { delivery: "refused"; error: string };

/**
 * The host's own words for a failed send.
 *
 * Shared because two callers need it and a refusal that swallows the reason
 * sends the reader hunting for a cause only the host named. Every send failure
 * a reader can trigger is reported with this, never with a generic apology.
 */
export function sendError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not reach the worker thread.";
}

export async function sendAgentInput(
  bb: BbPluginApi,
  card: WorkerCard,
  input: ThreadInput,
): Promise<AgentDispatch> {
  try {
    const result = await bb.sdk.threads.send({
      threadId: card.worker_thread_id!,
      mode: "auto",
      input,
    });
    if (result.delivery === "sent") return { delivery: "sent" };
    // A row the host queued without naming a wait is still not a dispatch, and
    // hostHold degrades it to the generic hold rather than dropping it.
    return { delivery: "queued", hold: hostHold([result.queuedMessage])! };
  } catch (error) {
    // The message is kept, not discarded: a reader who pressed Resume and got
    // a refusal needs the host's own words for why, not a generic apology.
    return {
      delivery: "refused",
      error: sendError(error),
    };
  }
}

export function agentText(text: string): ThreadInput[number] {
  return { type: "text", text, mentions: [], visibility: "agent-only" };
}
