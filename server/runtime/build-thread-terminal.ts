/**
 * What a card does once its workflow has reached the terminal stage.
 *
 * Reaching `audit` is not completing: completion is an explicit worker commit
 * (`bb stelow done`), verified in code. So an audit-idle worker is resumed
 * with the done instruction — bounded, because a worker that narrates
 * completion and stops would otherwise be nudged forever — and when the
 * budget runs out the card parks with the instruction still on it.
 *
 * This is its own module by rule, not by convenience: everything that decides
 * "this workflow is over, and only the worker can end it" lives in one file,
 * so a change to that decision cannot half-land in the sync loop.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  MAX_DONE_NUDGES,
  nextAutoContinue,
  shouldDoneNudge,
} from "../../lib/auto-continue.mjs";
import type { WorkerCard } from "../workers-types.js";
import { recordPausedAfter } from "./paused-inbox.js";
import { agentText, sendAgentInput } from "./thread-send.js";

export type TerminalSnapshot = {
  card: WorkerCard;
  stage: string;
  status: string;
  lastOutput: string | null;
};

type CardUpdate = Record<string, unknown>;

/**
 * Only what the terminal park reads. Narrower than the whole sync's deps on
 * purpose: a module that declares the surface it uses is a module whose seam
 * is checkable.
 */
export type TerminalIdleDeps = {
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  updateCard: (cardId: string, fields: CardUpdate) => void;
  logComment: (cardId: string, body: string) => void;
  recordInbox: (
    card: WorkerCard,
    kind: "paused",
    message: string,
    key: string,
    at: number,
  ) => void;
  auditDoneNudge: string;
  idleAttentionMs: number;
};

export async function syncTerminalIdle(
  deps: TerminalIdleDeps,
  snapshot: TerminalSnapshot,
  transitioning: boolean,
): Promise<boolean> {
  if (await sendDoneNudge(deps, snapshot, transitioning)) return true;
  // This notice claims a stage was REACHED, so it is gated on the stage moving.
  // It hung off `transitioning`, which is derived from `activity` — and a native
  // run flips activity, so one card re-announced the same arrival twice.
  const enteredAudit = snapshot.stage === "audit" && snapshot.card.stage !== "audit";
  if (snapshot.card.status !== "completed" && enteredAudit) {
    deps.logComment(
      snapshot.card.id,
      "The workflow reached the audit stage, but the card completes only when the worker " +
      "runs `bb stelow done` (verified in code — build at audit, never past a pending " +
      "question). Resume continues the worker with that instruction; nothing is done until done runs.",
    );
  }
  const idleAt = snapshot.card.last_idle_at ?? deps.now();
  deps.updateCard(snapshot.card.id, {
    activity: "idle",
    last_assistant_text: snapshot.lastOutput,
    last_error: null,
    last_idle_at: idleAt,
    stage: snapshot.stage,
  });
  recordPausedAfter(
    deps,
    snapshot.card.id,
    idleAt,
    "At audit, waiting for the worker to run `bb stelow done` — resume continues it with that instruction.",
  );
  return false;
}

async function sendDoneNudge(
  deps: TerminalIdleDeps,
  snapshot: TerminalSnapshot,
  transitioning: boolean,
): Promise<boolean> {
  const decision = shouldDoneNudge({
    status: snapshot.status,
    cardStatus: snapshot.card.status,
    questionPending: false,
    transitioningIntoIdle: transitioning,
    autoCount: snapshot.card.auto_continue_count ?? 0,
    autoStage: snapshot.card.auto_continue_stage ?? null,
  });
  if (!decision.proceed) return false;
  const sent = await sendAgentInput(
    deps.bb,
    snapshot.card,
    [agentText(deps.auditDoneNudge)],
  );
  if (!sent) return false;
  const next = nextAutoContinue({
    stage: snapshot.stage,
    autoCount: snapshot.card.auto_continue_count ?? 0,
    autoStage: snapshot.card.auto_continue_stage ?? null,
  });
  const fields: CardUpdate = {
    activity: "running",
    last_idle_at: null,
    last_error: null,
    auto_continue_count: next.count,
    auto_continue_stage: next.stage,
  };
  if (snapshot.lastOutput != null) fields.last_assistant_text = snapshot.lastOutput;
  deps.updateCard(snapshot.card.id, fields);
  return true;
}
