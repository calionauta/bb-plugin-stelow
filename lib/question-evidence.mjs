/**
 * Question evidence: proof before asking or marking done.
 * Merges gate-ask-evidence (review-gate floor), task-evidence (task/scope
 * rollups), question-answer-recording (answer doors), ask-persist-failure
 * (persist-failure record). Pure and deterministic; verdicts arrive from
 * the single decision-api point and are only resolved here. No spawning.
 */
import { resolveScoredVerdicts } from "./score-verdicts.mjs";

/**
 * Evidence gate for review gates. A gate stage (product, interface,
 * selection, tech plan) exists to review an artifact: a gateless question
 * ("approve the plan" with nothing to read) repeats the exact failure it
 * guards. The host refuses standard asks with no evidence attached —
 * methodology text stays advisory, this is the enforcement. An inline
 * `--preview` glance counts as evidence for short content; `--force` opts
 * out explicitly. Label-only options keep working everywhere else.
 */

export const GATE_EVIDENCE_STAGES = ["gate", "int-gate", "selection", "plan-gate"];

// Selection is a blind-choice machine without per-option evidence: every
// proposal must carry its own glance or file (upstream Pattern 2), so one
// evidenced option cannot launder blind siblings. Other gates review one
// shared document ("Approve" / "Request changes" are legitimately
// label-only), so a single evidence anywhere in the ask suffices there.
export const PER_OPTION_EVIDENCE_STAGES = ["selection"];

function hasEvidence(option) {
  if (option === null || typeof option !== "object" || Array.isArray(option)) return false;
  if (option.artifact !== null && option.artifact !== undefined) return true;
  return typeof option.preview === "string" && option.preview.trim().length > 0;
}

/**
 * Decide whether a worker ask may reach the human.
 * Returns { allowed, error }: refusals name the fix, never dead-end.
 */
export function gateEvidenceGate({ kind, stage, tag, forced, groups }) {
  if (forced) return { allowed: true, error: null };
  if (tag === "split") return { allowed: true, error: null };
  if (kind !== "build") return { allowed: true, error: null };
  if (!GATE_EVIDENCE_STAGES.includes(stage)) return { allowed: true, error: null };
  const options = (Array.isArray(groups) ? groups : []).flatMap((group) =>
    Array.isArray(group?.options) ? group.options : [],
  );
  if (options.length === 0) {
    return {
      allowed: false,
      error: `Refused: this build card is at \`${stage}\`, a review gate with nothing to review — `
        + "attach the artifact under decision via --artifact <workspace-relative path> "
        + "(or --preview for a short inline glance) on at least one option, or re-run with --force.",
    };
  }
  if (PER_OPTION_EVIDENCE_STAGES.includes(stage)) {
    if (options.every(hasEvidence)) return { allowed: true, error: null };
    return {
      allowed: false,
      error: `Refused: this build card is at \`${stage}\`, where every option is a proposal to compare — `
        + "attach --preview and --artifact on every option (labels alone force a blind choice), "
        + "or re-run with --force.",
    };
  }
  if (options.some(hasEvidence)) return { allowed: true, error: null };
  return {
    allowed: false,
    error: `Refused: this build card is at \`${stage}\`, a review gate with nothing to review — `
      + "attach the artifact under decision via --artifact <workspace-relative path> "
      + "(or --preview for a short inline glance) on at least one option, or re-run with --force.",
  };
}


/**
 * Task-completion evidence (pure, no DB).
 *
 * A completed task status is a worker assertion — this module turns it
 * into a checkable question: given the working-tree diff, does each
 * completed task show evidence of completion? One atomic Score question
 * per task (same Jev shape as skill criteria), resolved against the
 * point's confidence floor. Verdicts are advisory findings, never gates:
 * met / unmet / unverifiable, with low-confidence degrading to
 * unverifiable instead of guessing.
 */

export const TASK_EVIDENCE_DIFF_CHARS = 6000;

// One atomic Score per completed task, keyed for answer lookup. The
// question carries the task plus its parent scope so the judge does not
// score floating text without context.
export function tasksToScoreQuestions(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const questions = {};
  for (const task of list) {
    if (!task || typeof task !== "object") continue;
    const id = typeof task.id === "string" && task.id.length > 0 ? task.id : null;
    const name = typeof task.name === "string" && task.name.length > 0 ? task.name : null;
    if (!id || !name) continue;
    const scope = typeof task.scope === "string" && task.scope.length > 0 ? ` (scope: ${task.scope})` : "";
    questions[`task:${id}`] = {
      type: "score",
      instructions: `Does the diff show this task completed? ${name}${scope}`,
      criteria: ["Not done", "Partially done", "Clearly done"],
    };
  }
  return questions;
}

// Map scored answers (Jev) or parsed preset verdicts onto one findings
// shape — the shared resolver owns the degradation rules.
export function resolveTaskVerdicts({ tasks, answers, verdicts, routeAt = 0.6 }) {
  return resolveScoredVerdicts({ items: tasks, answers, verdicts, keyPrefix: "task", routeAt });
}

// A task may carry its own verify command (Spec-Kit shape: the task is
// born testable). String only — arrays/objects read as absent and fall
// back to the judge. Commands run checkout-pinned via execFile (no shell),
// never on blind trust: the worker already owns a shell, so this grants
// no new privilege, only determinism where the worker declared it.
export function taskVerifyCommand(task) {
  if (!task || typeof task !== "object") return null;
  const cmd = typeof task.verify === "string" ? task.verify.trim() : "";
  return cmd.length > 0 ? cmd : null;
}

// Scope rollup (pure, deterministic, zero LLM cost): a scope verdict
// derives from its tasks' verdicts — met iff every task met, unmet iff
// any task unmet, else unverifiable. Scopes that are not done read as
// open (pending work is openly pending, never a verdict). Done scopes
// with zero tasks read unverifiable: nothing evidenced them. No judge
// is consulted here by design — the tasks above already paid for one.
export function resolveScopeVerdicts({ scopes, taskFindings }) {
  const list = Array.isArray(scopes) ? scopes : [];
  const byId = new Map();
  for (const finding of Array.isArray(taskFindings) ? taskFindings : []) {
    if (finding && typeof finding === "object" && typeof finding.id === "string") byId.set(finding.id, finding.verdict);
  }
  return list
    .filter((scope) => scope && typeof scope === "object")
    .map((scope, index) => {
      const id = typeof scope.id === "string" && scope.id.length > 0 ? scope.id : `scope-${index + 1}`;
      const name = typeof scope.name === "string" && scope.name.length > 0 ? scope.name : id;
      const status = typeof scope.status === "string" ? scope.status : "?";
      if (status !== "done" && status !== "completed") {
        return { id, name, status, verdict: "open", detail: "pending work is openly pending" };
      }
      const tasks = Array.isArray(scope.tasks) ? scope.tasks : [];
      if (tasks.length === 0) {
        return { id, name, status, verdict: "unverifiable", detail: "no tasks to evidence" };
      }
      const verdicts = tasks.map((task) => (task && typeof task.id === "string" ? byId.get(task.id) ?? "unverifiable" : "unverifiable"));
      if (verdicts.every((verdict) => verdict === "met")) {
        return { id, name, status, verdict: "met", detail: `${verdicts.length} of ${verdicts.length} tasks evidenced` };
      }
      if (verdicts.some((verdict) => verdict === "unmet")) {
        return { id, name, status, verdict: "unmet", detail: "at least one task without evidence" };
      }
      return { id, name, status, verdict: "unverifiable", detail: "tasks unevaluated or below floor" };
    });
}

/* ---- merged from lib/question-evidence.mjs ---- */
/**
 * One recording rule for every answer, whichever door it arrived through.
 *
 * Context: a card question has two answering doors — a live host interaction
 * (`answerQuestions`) and a persisted recovery row for a question whose
 * interaction timed out (`answerExpiredQuestions`). Both consume the same
 * ask contract, record the same split answer, mark the same inbox event
 * answered, and clear the same stale failure. That shared tail was pasted
 * twice and the two copies had already drifted: the live door only wrote a
 * trail comment when a contract matched, the recovery door always did, and
 * each spelled the contract differently. One `grep` over the trail could
 * therefore miss a real contract.
 *
 * These helpers are pure so the rule is testable without a database. The
 * caller supplies the effects (contract consumption, comment, split, inbox,
 * card patch) because those need the host; this module owns only the
 * decisions — what the trail says and what the card looks like afterwards.
 *
 * Decided once, here, for both doors.
 */

/**
 * The answer trail comment for a batch, or null when there is nothing worth
 * recording. Every answer leaves a record naming the outcome and its
 * evidence — never a bare toast — so an undeclared answer is still written
 * (state honesty); a declared one additionally names the contract it
 * satisfied, so a later `grep` for the contract id finds it either way.
 */
export function answerCommentBody(decisions) {
  const list = Array.isArray(decisions) ? decisions : [];
  const notes = [];
  for (const decision of list) {
    if (decision === null || typeof decision !== "object" || Array.isArray(decision)) continue;
    const question = typeof decision.question === "string" ? decision.question : "";
    const answers = Array.isArray(decision.answers) ? decision.answers.filter((answer) => typeof answer === "string") : [];
    if (question.length === 0) continue;
    const contract = typeof decision.contract === "string" && decision.contract ? decision.contract : null;
    const suffix = contract ? ` [contract: ${contract}]` : "";
    notes.push(`Q: ${question}\nA: ${answers.length > 0 ? answers.join(", ") : "(skipped — use your recommendation)"}${suffix}`);
  }
  return notes.length > 0 ? `Answer to a pending question:\n\n${notes.join("\n\n")}` : null;
}

/**
 * A recovery question is addressed in the same id space as a live one, so
 * one card can list, answer, and resolve both without the caller knowing
 * which door a question came through. The prefix is the only discriminator.
 */
export const EXPIRED_QUESTION_ID_PREFIX = "expired:";

export function expiredQuestionId(rowId) {
  return `${EXPIRED_QUESTION_ID_PREFIX}${rowId}`;
}

export function isExpiredQuestionId(questionId) {
  return typeof questionId === "string" && questionId.startsWith(EXPIRED_QUESTION_ID_PREFIX);
}

export function expiredQuestionRowId(questionId) {
  return isExpiredQuestionId(questionId) ? questionId.slice(EXPIRED_QUESTION_ID_PREFIX.length) : questionId;
}

/**
 * Parse `bb stelow answer` argv into question/answer pairs.
 *
 * The pairing is positional on purpose: `--answer` belongs to the
 * `--question` immediately before it, so a multi-select question is written
 * `--question q1 --answer a --answer b`. An unknown flag is an error rather
 * than something to skip — a typo'd `--question` would otherwise answer the
 * wrong question, which is the one failure mode a human cannot see.
 *
 * Returns `{ pairs, json }` or `{ error }` (usage text, English).
 */
export function parseAnswerArgs(args) {
  const list = Array.isArray(args) ? args : [];
  const pairs = [];
  let json = false;
  let pendingQuestion = null;
  const allowed = new Set(["--card", "--question", "--answer", "--json"]);
  const usage = "bb stelow answer --card <card_id> --question <question_id> --answer <text> [--json]"
    + " (--answer \"\" on a multiple-choice question answers none)";
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (token === "--json") { json = true; continue; }
    if (typeof token !== "string" || !allowed.has(token)) {
      return { error: `Unknown flag ${token}. Usage: ${usage}` };
    }
    const value = list[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      return { error: `${token} needs a value.` };
    }
    if (token === "--card") { i++; continue; }
    if (token === "--question") { pendingQuestion = value; i++; continue; }
    if (pendingQuestion === null) {
      return { error: "--answer must follow a --question <question_id>." };
    }
    // Keep the pending question so a multi-select can repeat --answer; the
    // next --question (or the end of argv) closes the group.
    pairs.push({ question: pendingQuestion, answer: value });
    i++;
  }
  if (pairs.length === 0) {
    return { error: `Usage: ${usage} (repeat pairs; answer every open question in one call)` };
  }
  return { pairs, json };
}

/**
 * Group positional pairs into the atomic answer payload, keeping multi-select
 * answers on their own question. A question id is either a live host
 * interaction id or a prefixed recovery row id; the two doors are reported
 * apart so a caller never half-answers both in one call.
 */
export function buildAnswerPayload(pairs) {
  const grouped = new Map();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (pair === null || typeof pair !== "object") continue;
    const list = grouped.get(pair.question) ?? [];
    list.push(pair.answer);
    grouped.set(pair.question, list);
  }
  const entries = [...grouped.entries()].map(([questionId, answers]) => ({ questionId, answers }));
  return {
    live: entries.filter((entry) => !isExpiredQuestionId(entry.questionId)),
    expired: entries.filter((entry) => isExpiredQuestionId(entry.questionId)),
  };
}

/**
 * The card patch that follows an answer: a fresh human decision resumes the
 * worker, so the interrupted turn's failure must not linger beside the
 * recovery path. `hasOpenQuestions` keeps a card that still has other
 * questions parked instead of showing it as running.
 */
export function answeredCardPatch(hasOpenQuestions) {
  return {
    activity: hasOpenQuestions ? "awaiting-answer" : "running",
    status: "in-progress",
    last_error: null,
  };
}

/* ---- merged from lib/question-evidence.mjs ---- */
/**
 * What the card should say when a question could not be persisted.
 *
 * The failure this exists for, reported as a runbook in the README before it was a feature:
 * a worker asks, the answer times out, and the write of the expired-question rows fails —
 * a `SQLITE_BUSY` that outlives both retries, a closed handle, a full disk. The worker
 * prints "The question could not be recorded" and stops, which is correct. What the card
 * shows is the problem.
 *
 * `blockOnAnswer` marks the card `awaiting-answer` before the blocking wait and sets it
 * back to running when the call ends, which happens BEFORE the persist is attempted. So a
 * failed persist leaves a card that is idle, has no pending question, and carries no trace
 * of what happened — visually identical to a card between turns. The only evidence was a
 * line in the plugin log that nobody reads.
 *
 * That is a phantom wait by this project's own rule ("any user-facing wait needs a live
 * question behind it"; "a phantom wait is a bug"), and the fix is not a better log line: it
 * is a record on the card and an inbox event, so a reader sees the failure where they are
 * already looking.
 *
 * The text is built here, in `lib/`, because it is a rule about what a reader must be told
 * rather than a string in a handler: the cause, the fact that nothing was lost, and the one
 * action that recovers it.
 */

/** Whether a persist failure is worth waking someone for. A single retry that succeeds
 * never reaches here; a non-retryable error is a broken installation (closed handle, full
 * disk) and does. Kept as its own predicate because the caller must not have to reason
 * about which sqlite errors are transient. */
export function shouldRecordPersistFailure({ persisted, error }) {
  if (persisted) return false;
  // A null `error` with `persisted: false` cannot happen today (the loop only leaves
  // `persisted` false by catching), but treating it as unrecordable rather than throwing
  // keeps this usable from a failure path, where throwing is the worst possible response.
  if (typeof error !== "string" || error.trim() === "") return false;
  return true;
}

/** The card trail line. Names the cause, says plainly that nothing was lost, and gives the
 * one action that recovers it — the same shape every other refusal in this project uses. */
export function persistFailureTrailLine({ threadId, error }) {
  // The thread id is in the line because "the worker thread" is a place, and a reader who
  // wants to act needs to know which one — on a card with restarts there is more than one
  // worker thread in the history. `cardId` is the line's own target and is not repeated in
  // its text.
  return `A question could not be recorded, so it is NOT pending on this card. `
    + `The worker stopped and will re-ask once. `
    + `Cause: ${error}. `
    + `Nothing was lost — the question was never stored, so there is nothing to recover. `
    + `To resume: send any message on worker thread ${threadId}.`;
}

/**
 * The inbox event, so the failure is visible from the inbox rather than only from the card.
 *
 * `dedupeKey` is keyed on the card and NOT on the error text: the same broken handle fails
 * repeatedly, and a reader wants one entry that counts the repetitions rather than a new row
 * per attempt. The card is the key's unit because the card is what a person acts on.
 */
export function persistFailureInboxEvent({ cardId, error }) {
  return {
    /** Matches the host recorder's `(card, kind, summary, dedupeKey, occurredAt)` shape.
     * Kept as named fields rather than a positional tuple so the caller reads as what it
     * is recording, and so `prettier`/`oxlint` cannot silently reorder a wrong argument. */
    card: { id: cardId },
    kind: "error",
    summary: `A question on this card could not be recorded (${error}). `
      + `The worker stopped and will re-ask once — send any message on the worker thread to resume.`,
    /** Keyed on the card, never on the error text: the same broken handle fails repeatedly,
     * and a reader wants one entry whose count grows rather than a row per attempt. */
    dedupeKey: `ask-persist-failed:${cardId}`,
    occurredAt: 0,
  };
}
