import { questionWaitUpdates } from "../../lib/question-store.mjs";
import { statusForNewCardWork } from "../../lib/card-work-resume.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import type { WorkerCard } from "../workers-types.js";
import { parseCurrentStage } from "../../lib/current-stage.mjs";

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
  const stage = clean(parseCurrentStage(stateBlob) ?? undefined) || card.stage;
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
  // A projection that just re-read the card's own state file supersedes
  // whatever the last failure said. Without this the text is permanent: only
  // the resume paths cleared it, so a card that failed once — even for a
  // reason the host itself caused — kept telling the reader "Reseed this
  // card" days later, next to a worker that was never reseeded and never
  // needed to be.
  const updates: Record<string, unknown> = {
    activity: "running",
    last_assistant_text: lastOutput,
    last_error: null,
    status: statusForNewCardWork({
      kind: card.kind,
      status: card.status,
      stage,
    }).status,
  };
  if (stage !== card.stage) updates.stage = stage;
  return updates;
}

/**
 * A worker thread the host says does not exist.
 *
 * The id is a promise the card keeps failing to honour: every poll answers 404,
 * `last_error` is rewritten with the raw host string, and every Retry re-reads
 * the same dead id — two cards were sitting that way, one of them still
 * advertising "The agent is waiting for your answer to continue" over a thread
 * that had been deleted. Nothing in `server/**` or `lib/**` named the string, so
 * no path could ever tell "the thread is gone" from "the host hiccuped".
 *
 * Clearing `worker_thread_id` is the honest repair: the card then has no worker,
 * which is true, and Restart spawns one instead of re-asking the void. The
 * message says what the reader can do rather than quoting a transport error.
 */
const THREAD_GONE = /thread[_ ]not[_ ]found|HTTP 404: Thread not found/i;

export function projectThreadError(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : "Unable to read worker thread.";
  if (THREAD_GONE.test(message)) {
    return {
      activity: "error",
      worker_thread_id: null,
      last_error: "This card's worker thread no longer exists. Start a new worker to continue.",
    };
  }
  return { activity: "error", last_error: message };
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
    card.last_idle_text != null &&
    lastOutput != null &&
    lastOutput === card.last_idle_text,
  );
}

function clean(value: string | undefined): string {
  return String(value ?? "").trim();
}
