/**
 * What a card does once its workflow has reached the terminal stage.
 *
 * Reaching `audit` is not completing: completion is an explicit worker commit
 * (`bb stelow done`), verified in code. So an audit-idle worker gets the done
 * instruction — bounded, because a worker that narrates completion and stops
 * would otherwise be nudged forever — and when the budget runs out the card
 * parks and says which park it is.
 *
 * That last part is the reason this is its own module. The park used to be one
 * sentence for every case, including the case where there was no instruction
 * left to give, which taught a reader to press Resume against a done gate
 * that had already refused twice. Naming the reason is what turns a park into
 * something a reader can act on.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  MAX_DONE_NUDGES,
  nextAutoContinue,
  shouldDoneNudge,
} from "../../lib/auto-continue.mjs";
import type { lastTurnStelowCalls } from "../../lib/auto-continue.mjs";
import type { WorkerCard } from "../workers-types.js";
import { recordPausedAfter } from "./paused-inbox.js";
import { agentText, sendAgentInput } from "./thread-send.js";

export type TerminalSnapshot = {
  card: WorkerCard;
  stage: string;
  status: string;
  lastOutput: string | null;
};

/**
 * What the finished turn did with Stelow's own verbs. `null` is "don't know" —
 * the read failed — and every sentence in `auditPauseReason` then reads as it
 * did before this signal existed, which is the fail-open rule this file keeps
 * everywhere else.
 */
export type StelowCalls = ReturnType<typeof lastTurnStelowCalls> | null;

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
  calls: StelowCalls,
): Promise<boolean> {
  const nudge = await sendDoneNudge(deps, snapshot, transitioning);
  if (nudge.sent) return true;
  // The caller read the finished turn's verbs once and hands them over. It
  // does so even when the nudge is about to fire, so this module holds no read
  // of its own: two fetches would be two windows, and the card could be
  // described by events that stopped being true between them.
  const lastTurn = calls;
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
  recordPausedAfter(deps, snapshot.card.id, idleAt, auditPauseReason(nudge.reason, lastTurn));
  return false;
}

/**
 * Why an audit card is parked, in the words the reader gets.
 *
 * "Resume continues the worker with that instruction" was true and useless on
 * the card that motivated this: the host had already resumed twice, the done
 * gate still refused, and the sentence never said the budget was spent — so
 * the reader resumed, watched the same refusal come back, and resumed again.
 * A park nobody can act on is a deadlock with a friendly message, so the
 * spent budget is named and the reader is told what a resume would and would
 * not change.
 *
 * The two `done` arms are the same principle about a different park. A worker
 * that ran `bb stelow done` and was refused is not waiting for the host to
 * explain the instruction — it already knows, and the gate's answer is the last
 * thing on the card. card_hh2nwqs4 sat on the generic sentence for that reason.
 * Prose stays invisible here, deliberately: a worker that narrates stopping
 * without running anything and without asking a question gives the host nothing
 * verifiable to say, and the host will not classify prose to manufacture a
 * sentence for it.
 */
function auditPauseReason(reason: string, calls: StelowCalls): string {
  if (calls?.doneFailed) {
    return "At audit, the worker ran `bb stelow done` and the gate refused it. The refusal is the \
last thing on the card — fix what it names. Resuming repeats the same refusal.";
  }
  if (calls?.done) {
    return "At audit, the worker ran `bb stelow done` and the card is not complete. Re-read the \
refusal above before resuming.";
  }
  if (reason === "done-nudge budget exhausted") {
    return `At audit, waiting for the worker to run \`bb stelow done\` — the host already resumed it ${MAX_DONE_NUDGES} times with that \
instruction and stopped. Another resume repeats it, so read the refusal on the card first: that refusal is what has to change.`;
  }
  if (reason === "a question is pending an answer") {
    return "At audit with a question open on the card — answer it and the worker continues from there.";
  }
  return "At audit, waiting for the worker to run `bb stelow done` — resume continues the worker with that instruction.";
}

/** The nudge's own verdict: whether it resumed the worker, and why not. */
type DoneNudge = { sent: boolean; reason: string };

async function sendDoneNudge(
  deps: TerminalIdleDeps,
  snapshot: TerminalSnapshot,
  transitioning: boolean,
): Promise<DoneNudge> {
  const decision = shouldDoneNudge({
    status: snapshot.status,
    cardStatus: snapshot.card.status,
    questionPending: false,
    transitioningIntoIdle: transitioning,
    autoCount: snapshot.card.auto_continue_count ?? 0,
    autoStage: snapshot.card.auto_continue_stage ?? null,
  });
  if (!decision.proceed) return { sent: false, reason: decision.reason };
  const sent = await sendAgentInput(
    deps.bb,
    snapshot.card,
    [agentText(deps.auditDoneNudge)],
  );
  if (!sent) return { sent: false, reason: "the worker thread did not accept the message" };
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
  return { sent: true, reason: "resumed with the done instruction" };
}
