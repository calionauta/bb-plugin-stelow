import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerCard } from "../workers-types.js";

type ThreadInput = Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0]["input"];

export async function sendAgentInput(
  bb: BbPluginApi,
  card: WorkerCard,
  input: ThreadInput,
): Promise<boolean> {
  try {
    await bb.sdk.threads.send({ threadId: card.worker_thread_id!, mode: "auto", input });
    return true;
  } catch {
    return false;
  }
}

export function agentText(text: string): ThreadInput[number] {
  return { type: "text", text, mentions: [], visibility: "agent-only" };
}
