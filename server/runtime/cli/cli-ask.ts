import { classifyAskCancel, interruptionWhy, isRetryablePersistError } from "../../../lib/ask-cancel.mjs";
import { askTimelineLabels, describeAskSubmission } from "../../../lib/question-presentation.mjs";
import { askFinishedUpdates } from "../../../lib/card-question-state.mjs";
import { splitEligibility } from "../../../lib/split-proposal.mjs";
import { array, record } from "../values.js";
import {
  askOwningCard,
  askTimeoutMs,
  declareAskContracts,
  discloseStandardSplit,
  gateAsk,
  parseAskIntent,
  recordSplitProposal,
  verifyAskSurface,
  type AskGroup,
} from "./cli-ask-gate.js";
import type { CliCommandFn, CliResult, Refusal } from "./cli-contract.js";
import type { CliDeps, PendingAsk } from "./cli-deps.js";

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
    return blockOnAnswer(deps, card.id, intent, ctx.signal);
  };
}

/** The pre-call refusal chain, in the order the host decides them: gate
 * precedence, then contract declaration, then the split proposal shape. */
async function askRefusals(
  deps: CliDeps,
  cardId: string,
  liveAsks: PendingAsk[],
  intent: { tag: "split" | null; groups: AskGroup[] },
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
  intent: { threadId: string; tag: "split" | null; groups: AskGroup[]; batched: boolean },
  signal: AbortSignal | undefined,
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
  const requested = await requestAnswer(deps, intent, signal);
  // The ask call ended (answered, cancelled, or torn down): mark the worker
  // running again. Activity only — board position is owned by the sync poll,
  // the answer RPCs, and advance/moveCard, on both tracks.
  // See lib/card-question-state.
  deps.updateCard(cardId, askFinishedUpdates());
  const cancelReason =
    requested.result.outcome === "cancelled" ? requested.result.reason : null;
  const transientCancel =
    requested.failed ||
    classifyAskCancel(requested.result.outcome, cancelReason) === "persist";
  if (transientCancel)
    return persistUnanswered(deps, cardId, threadId, groups, askedAt, requested);
  return answerOutcome(deps, cardId, intent, requested);
}

type Requested = { result: AskOutcome; failed: boolean };

/** The interaction payload BB shows and waits on. The pending timeline label
 * names the wait while the form is open (BB 0.43), and describeSubmission
 * decides what the transcript keeps — decisions only, never the payload or
 * the raw value. Hosts that predate the fields ignore them. */
function askInputFor(intent: { threadId: string; groups: AskGroup[]; batched: boolean }) {
  return {
    threadId: intent.threadId,
    rendererId: "stelow-question",
    title: intent.batched
      ? `Stelow questions (${intent.groups.length})`
      : "Stelow question",
    timeoutMs: askTimeoutMs(),
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
): Promise<Requested> {
  const { groups } = intent;
  const askInput = askInputFor(intent);
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

/** Cancellation without an answer falls into two buckets. Transient
 * infrastructure reasons (timeout, plugin reload/restart, aborted request)
 * mean the user simply never answered: persist the question exactly like a
 * timeout so it stays answerable on the card and the worker stops to wait.
 * Explicit end states (user dismissed, thread stopped/deleted) are returned
 * as-is for the worker to interpret. */
async function persistUnanswered(
  deps: CliDeps,
  cardId: string,
  threadId: string,
  groups: AskGroup[],
  askedAt: number,
  requested: Requested,
): Promise<CliResult> {
  const cancelReason =
    requested.result.outcome === "cancelled" ? requested.result.reason : null;
  let persisted = false;
  let persistError: string | null = null;
  // Two attempts: a concurrent writer (reconcile timer, sync poll) can hold the
  // lock briefly — SQLITE_BUSY is transient, not fatal.
  for (let attempt = 1; attempt <= 2 && !persisted; attempt++) {
    try {
      writeExpiredRows(deps, cardId, threadId, groups, askedAt);
      persisted = true;
    } catch (err) {
      persistError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      deps.bb.log.warn(
        `stelow ask persist attempt ${attempt}/2 failed (card ${cardId}, thread ${threadId}): ${persistError}`,
      );
      if (isRetryablePersistError(persistError) && attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      } else {
        break;
      }
    }
  }
  const elapsed = Math.round((deps.now() - askedAt) / 1e3);
  if (!persisted) {
    const whyPersistFailed = requested.failed
      ? "request failure"
      : `cancel reason "${cancelReason ?? "unknown"}"`;
    return {
      exitCode: 1,
      stdout: `The question could not be recorded (interrupted storage after ${whyPersistFailed}). STOP and wait: do NOT proceed with the workflow. \
On your next turn, if no pending question exists on the card, ask it ONCE more via bb stelow ask.`,
    };
  }
  const why = interruptionWhy(cancelReason, requested.failed, elapsed);
  return {
    exitCode: 1,
    stdout: `${why} STOP and wait: do NOT proceed with the workflow. The question is still pending on the card (same column, marked as waiting \
for your answer) and remains answerable. When the user answers it on the card, the answer is delivered here as a message and you \
may continue. If you are re-asked about this same question later, do not re-ask the user again — wait for the card answer.`,
  };
}

/** A timed-out batch persists as one expired row per sub-question so the card
 * can answer them individually or all at once. */
function writeExpiredRows(
  deps: CliDeps,
  cardId: string,
  threadId: string,
  groups: AskGroup[],
  askedAt: number,
): void {
  const expiredAt = askedAt + askTimeoutMs();
  const insert = deps.db.prepare(
    "INSERT OR REPLACE INTO expired_questions (id, card_id, thread_id, question, multiple, kind, locale, options, expired_at, answered) \
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  deps.db.transaction(() => {
    for (const group of groups) {
      insert.run(
        deps.randomId("qexp"),
        cardId,
        threadId,
        group.question,
        group.multiple ? 1 : 0,
        group.kind,
        "en",
        JSON.stringify(group.options),
        expiredAt,
        0,
      );
    }
  })();
  deps.updateCard(cardId, { activity: "awaiting-answer" });
  deps.bb.realtime.publish("card-state", { cardId });
}

/** The host records what the human approved on a split proposal — right here
 * for the blocking call, and in the answer RPC for card-side answers. `bb
 * stelow split` trusts this row, never a worker claim. */
async function answerOutcome(
  deps: CliDeps,
  cardId: string,
  intent: { tag: "split" | null; groups: AskGroup[] },
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
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(result)}\nSplit check: recorded as STANDARD — its answer is text only and executes nothing. If this question \
proposes splitting the card, re-ask it now with --tag split --multiple plus exactly one --option "Keep as one card", then run \
bb stelow split after the answer (still at ${stage}, still in time).`,
  };
}
