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
  const usage = "bb stelow answer --card <card_id> --question <question_id> --answer <text> [--json]";
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
