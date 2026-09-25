import { questionWaitUpdates } from "../../lib/card-question-state.mjs";
import { statusForNewCardWork } from "../../lib/card-work-resume.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import type { WorkerCard } from "../workers-types.js";

const INTENT_VALUES = [
  "new-product",
  "feature",
  "bugfix",
  "refactor",
  "investigate",
] as const;

export function shouldSyncThread(card: WorkerCard | undefined): card is WorkerCard {
  return Boolean(
    card?.worker_thread_id &&
    !isArchivedCard(card) &&
    card.status !== "completed" &&
    card.status !== "blocked",
  );
}

export function isActiveStatus(status: string): boolean {
  return status === "active" || status === "starting";
}

export function isIdleStatus(status: string): boolean {
  return status === "idle" || status === "stopping";
}

export function projectStateMetadata(
  card: WorkerCard,
  stateBlob: string | null,
): { intent: string | null; stage: string } {
  const stage = clean(stateBlob?.match(/^current_stage:\s*(\S+)/m)?.[1]) || card.stage;
  const stateName = clean(stateBlob?.match(/^name:\s*(\S+)/m)?.[1]);
  const stateIntent = clean(stateBlob?.match(/^intent:\s*(\S+)/m)?.[1]);
  const intent = card.intent === "unknown" &&
    stateName === card.name &&
    stateIntent &&
    (INTENT_VALUES as readonly string[]).includes(stateIntent)
    ? stateIntent
    : null;
  return { intent, stage };
}

export function projectRunningState(
  card: WorkerCard,
  stage: string,
  lastOutput: string | null,
  questionIds: string[],
): Record<string, unknown> {
  if (questionIds.length > 0) return questionWaitUpdates(lastOutput);
  const updates: Record<string, unknown> = {
    activity: "running",
    last_assistant_text: lastOutput,
    status: statusForNewCardWork({
      kind: card.kind,
      status: card.status,
      stage,
    }).status,
  };
  if (stage !== card.stage) updates.stage = stage;
  return updates;
}

export function projectThreadError(error: unknown): Record<string, unknown> {
  return {
    activity: "error",
    last_error: error instanceof Error ? error.message : "Unable to read worker thread.",
  };
}

export function projectIdleTimestamp(
  card: WorkerCard,
  transitioningIntoIdle: boolean,
  noProgress: boolean,
  nowMs: number,
  idleAttentionMs: number,
): number | null {
  if (noProgress) return nowMs - idleAttentionMs;
  if (transitioningIntoIdle || !card.last_idle_at) return nowMs;
  return card.last_idle_at;
}

export function projectNoProgress(
  card: WorkerCard,
  transitioningIntoIdle: boolean,
  lastOutput: string | null,
): boolean {
  return Boolean(
    transitioningIntoIdle &&
    card.last_assistant_text != null &&
    lastOutput != null &&
    lastOutput === card.last_assistant_text,
  );
}

function clean(value: string | undefined): string {
  return String(value ?? "").trim();
}
