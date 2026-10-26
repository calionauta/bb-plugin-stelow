import { classifyAskCancel } from "../../../lib/question-gate.mjs";
import { kickQuestionSync } from "../../../lib/question-store.mjs";
import { askTimelineLabels, describeAskSubmission } from "../../../lib/question-presentation.mjs";
import { QUESTION_RENDERER_ID } from "../../../lib/question-batch.mjs";
import { askFinishedUpdates } from "../../../lib/question-store.mjs";
import { answerMentionsSplit, splitEligibility } from "../../../lib/split-proposal.mjs";
import { array, record } from "../values.js";
import {
  askOwningCard,
  declareAskContracts,
  discloseStandardSplit,
  gateAsk,
  parseAskIntent,
  recordSplitProposal,
  verifyAskSurface,
  type AskGroup,
  type AskTag,
} from "./cli-ask-gate.js";
import type { CliCommandFn, CliResult, Refusal } from "./cli-contract.js";
import type { CliDeps, PendingAsk } from "./cli-deps.js";
import { persistUnanswered } from "./cli-ask-persist.js";

type AskOutcome = { outcome: string; reason: string | null; value?: unknown };

/** `bb stelow ask`: the one blocking host call a worker makes. Every refusal
 * happens before the call, so a rejected ask never pings the human; every
 * unanswered ask is persisted as an expired row, so it stays answerable on the
 * card and the worker stops to wait instead of guessing. */
export function createAskCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "ask") return null;
    const intent = parseAskIntent(argv, ctx);
    if ("refusal" in intent) return intent.refusal;
    const card = askOwningCard(deps, intent.threadId);
    if ("refusal" in card) return card.refusal;
    const liveAsks = await verifyAskSurface(deps, intent.threadId);
    if ("refusal" in liveAsks) return liveAsks.refusal;
    const refusal = await askRefusals(deps, card.id, liveAsks, intent, argv);
    if (refusal) return refusal.refusal;
    return blockOnAnswer(deps, card.id, intent, ctx.signal, await deps.askTimeoutMs());
  };
}

/** The pre-call refusal chain, in the order the host decides them: gate
 * precedence, then contract declaration, then the split proposal shape. */
async function askRefusals(
  deps: CliDeps,
  cardId: string,
  liveAsks: PendingAsk[],
  intent: { tag: AskTag; groups: AskGroup[] },
  argv: string[],
): Promise<Refusal | null> {
  const gated = await gateAsk(deps, cardId, liveAsks, intent.tag, intent.groups, argv);
  if (gated) return gated;
  const contracts = await declareAskContracts(
    deps,
    cardId,
    intent.groups,
    intent.tag,
  );
  if (contracts) return contracts;
  if (intent.tag === "split")
    return recordSplitProposal(deps, cardId, intent.groups);
  await discloseStandardSplit(deps, cardId, intent.groups);
  return null;
}

async function blockOnAnswer(
  deps: CliDeps,
  cardId: string,
  intent: { threadId: string; tag: AskTag; groups: AskGroup[]; batched: boolean },
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<CliResult> {
  const { groups, threadId } = intent;
  deps.updateCard(cardId, { activity: "awaiting-answer" });
  // Baseline the questioned documents for staleness notices: what each file
  // contains and where its checkout stands, right now, before the blocking
  // wait begins. Advisory and fail-soft — never blocks asking.
  void deps.snapshotQuestionEvidence(
    cardId,
    groups.flatMap((group) => group.options),
  );
  const askedAt = deps.now();
  // The pending interaction exists host-side only once requestInput runs,
  // so the inbox row cannot be minted synchronously here. Kick one early
  // sync that observes it: without this the row waits for the 45s tick
  // while the card already shows the question. Idempotent, fire-and-forget.
  const cancelSyncKick = kickQuestionSync(deps, { threadId, cardId });
  const requested = await requestAnswer(deps, intent, signal, timeoutMs);
  cancelSyncKick();
  // The ask call ended (answered, cancelled, or torn down): mark the worker
  // running again. Activity only — board position is owned by the sync poll,
  // the answer RPCs, and advance/moveCard, on both tracks.
  // See lib/question-store.
  deps.updateCard(cardId, askFinishedUpdates());
  // Cancellation without an answer falls into two buckets. Transient
  // infrastructure reasons (timeout, plugin reload/restart, aborted request)
  // mean the user simply never answered: persist the question so it stays
  // answerable on the card. Explicit end states (dismissed, thread
  // stopped/deleted) are returned as-is for the worker to interpret.
  const cancelReason =
    requested.result.outcome === "cancelled" ? requested.result.reason : null;
  const transientCancel =
    requested.failed ||
    classifyAskCancel(requested.result.outcome, cancelReason) === "persist";
  if (transientCancel)
    return persistUnanswered(deps, cardId, threadId, groups, askedAt, requested, timeoutMs);
  return answerOutcome(deps, cardId, intent, requested);
}

type Requested = { result: AskOutcome; failed: boolean };

/** The interaction payload BB shows and waits on. The pending timeline label
 * names the wait while the form is open (BB 0.43), and describeSubmission
 * decides what the transcript keeps — decisions only, never the payload or
 * the raw value. Hosts that predate the fields ignore them. */
function askInputFor(
  intent: { threadId: string; groups: AskGroup[]; batched: boolean },
  timeoutMs: number,
) {
  return {
    threadId: intent.threadId,
    rendererId: QUESTION_RENDERER_ID,
    title: intent.batched
      ? `Stelow questions (${intent.groups.length})`
      : "Stelow question",
    timeoutMs,
    presentation: {
      label: askTimelineLabels({
        batched: intent.batched,
        count: intent.groups.length,
      }),
    },
    describeSubmission: (value: unknown) => describeAskSubmission(value),
  } as const;
}

async function requestAnswer(
  deps: CliDeps,
  intent: { threadId: string; groups: AskGroup[]; batched: boolean },
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Requested> {
  const { groups } = intent;
  const askInput = askInputFor(intent, timeoutMs);
  // Contract ids are host bookkeeping, not renderer input: strip them so the
  // interaction payload keeps its exact BB shape.
  const payloadGroups = groups.map((group) => ({
    question: group.question,
    multiple: group.multiple,
    kind: group.kind,
    options: group.options,
  }));
  const first = groups[0]!;
  try {
    const result = intent.batched
      ? await deps.bb.ui.requestInput(
          { ...askInput, payload: { questions: payloadGroups } },
          { signal },
        )
      : await deps.bb.ui.requestInput(
          {
            ...askInput,
            payload: {
              question: first.question,
              multiple: first.multiple,
              kind: first.kind,
              options: first.options,
            },
          },
          { signal },
        );
    return { result: result as AskOutcome, failed: false };
  } catch {
    // The request itself blew up mid-flight (e.g. dispose tore down the call):
    // same bucket as a transient cancel — never lose the question.
    return {
      result: { outcome: "cancelled", reason: "request-aborted" },
      failed: true,
    };
  }
}

/** The host records what the human approved on a split proposal — right here
 * for the blocking call, and in the answer RPC for card-side answers. `bb
 * stelow split` trusts this row, never a worker claim. */
async function answerOutcome(
  deps: CliDeps,
  cardId: string,
  intent: { tag: AskTag; groups: AskGroup[] },
  requested: Requested,
): Promise<CliResult> {
  const result = requested.result;
  if (intent.tag === "split" && result.outcome === "submitted") {
    const value = record(result.value);
    const picked = array(value.answers).filter(
      (answer): answer is string => typeof answer === "string",
    );
    deps.db
      .prepare(
        "UPDATE split_proposals SET selected = ?, answered_at = ? WHERE card_id = ? AND selected IS NULL",
      )
      .run(JSON.stringify(picked), deps.now(), cardId);
  }
  // Point-of-use split guard: a STANDARD ask at triage/select records an
  // answer that executes nothing. If the worker meant to propose a split, the
  // tag must be on the ask — remind once, while re-asking is still legal (the
  // card hasn't advanced; the call just unblocked).
  if (intent.tag !== "split" && result.outcome === "submitted") {
    const reminder = await standardSplitReminder(deps, cardId, result);
    if (reminder) return reminder;
  }
  return {
    exitCode: result.outcome === "submitted" ? 0 : 1,
    stdout: JSON.stringify(result),
  };
}

async function standardSplitReminder(
  deps: CliDeps,
  cardId: string,
  result: AskOutcome,
): Promise<CliResult | null> {
  const card = deps.getCard(cardId);
  // Same single-source gate, same slug truth: the reminder fires exactly where
  // a re-ask is still legal.
  const stage = card ? await deps.cardStageSlug(card) : null;
  if (!card) return null;
  const gate = splitEligibility({ kind: card.kind, stage });
  if (!gate.ok) return null;
  // The user picked a split direction in freeform words: point the worker
  // at the formal question now instead of letting it ask a second
  // freeform question about the same split. A bare reminder already covers
  // the general case below; this sentence fires only on the decision.
  const direct = answerMentionsSplit(result.value)
    ? " The user chose a split direction above — ask it formally NOW with"
      + " --tag split --multiple (slices plus exactly one \"Keep as one card\"),"
      + " then run bb stelow split after the answer. Open with Following your call"
      + " to split and preselect the named slices with --selected (Keep stays"
      + " unchecked). Do not ask another freeform question about this split first."
    : "";
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(result)}\nSplit check: recorded as STANDARD — its answer is text only and executes nothing. If this question \
proposes splitting the card, re-ask it now with --tag split --multiple plus exactly one --option "Keep as one card", then run \
bb stelow split after the answer (still at ${stage}, still in time).${direct}`,
  };
}
