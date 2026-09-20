/**
 * Shared presentation policy for card and thread questions.
 *
 * Structured questions are product UI, so their host-authored copy is always
 * English. Workers must author their question and option text in English too;
 * the renderer never guesses or translates arbitrary user content.
 */

const COPY = {
  en: {
    answerNeeded: "Your answer is needed",
    answersNeeded: (count) => `${count} questions need your answer`,
    questionOf: (current, total) => `Question ${current} of ${total}`,
    questions: "Questions",
    answered: "answered",
    other: "Other — write your own answer",
    customPlaceholder: "Type a custom answer…",
    skipped: "Skipped — answer it after all",
    skip: "Skip — let the AI use its recommendation",
    submitAnswer: "Submit answer",
    submitAnswers: "Submit answers",
    sending: "Sending…",
    back: "Back",
    next: "Next",
    continue: "Continue",
    continueWithAnswers: (count) => `Continue with ${count} answers`,
    batchProgress: (done, total, canSkip) => `${done} of ${total} answered${canSkip ? " (skipped counts as answered)" : ""}. Submit unlocks when every question has a decision.`,
    answersRemaining: (count, canSkip) => `${count} ${count === 1 ? "question remains" : "questions remain"}. ${canSkip ? "Answer or skip it before submitting." : "Answer it before submitting."}`,
    pickOneOrMore: "Pick one or more, then submit.",
    recoveryHeading: "Waiting for you",
  },
};

// The card is an English-only product surface. This deliberately conservative
// check catches the language that previously leaked from stale workers; it is
// a guardrail alongside the worker prompt, not an attempt to translate or
// infer arbitrary human writing.
const PORTUGUESE_SIGNAL = /\b(qual(?:is)?|solicita(?:ç|c)ão|entreg(?:a|á)veis?|permanecer|cart(?:ão|ao|ões|oes)|selecion(?:e|ar|ado)|resposta|trabalho|nenhum|prazo|você|voce|não|nao|refatorar|decompor|preservando|coordenada)\b|[áàâãéêíóôõúç]/i;

export function englishQuestionContentError(question, options = []) {
  const content = [question, ...(Array.isArray(options) ? options.flatMap((option) => [option?.label, option?.description]) : [])]
    .filter((value) => typeof value === "string")
    .join("\n");
  return PORTUGUESE_SIGNAL.test(content)
    ? "Structured card questions must be written in English. Translate the question, option labels, and descriptions, then retry once."
    : null;
}

export function questionCopy() {
  return COPY.en;
}

/**
 * Timeline row labels for a blocking ask (BB 0.43 `presentation`). One shape
 * for live and timed-out forms: the pending label names the wait, the
 * completed label names the resolution. Both stay under BB's 80-char cap.
 */
export function askTimelineLabels({ batched, count }) {
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  if (batched) {
    return {
      pending: `Stelow questions (${n}) — waiting for answers`,
      completed: `Stelow questions (${n}) — answered`,
    };
  }
  return {
    pending: "Stelow question — waiting for answer",
    completed: "Stelow question — answered",
  };
}

/**
 * Timeline description for a submitted ask (BB 0.43 `describeSubmission`).
 * BB persists only this — never the payload or the raw value — so it names
 * the decisions (chosen labels, skips) without storing question content.
 * Defensive by contract: unknown shapes fall back to BB's default labels,
 * never throw (a throw would leave the row with its completed label only).
 */
export function describeAskSubmission(value) {
  try {
    const answers = value !== null && typeof value === "object" && !Array.isArray(value) ? value.answers : null;
    if (!Array.isArray(answers)) return {};
    // Only a non-empty all-arrays shape is a batch: `[].every(...)` is
    // vacuously true, so an empty single answer must read as a skip.
    const isBatch = answers.length > 0 && answers.every((entry) => Array.isArray(entry));
    const groups = isBatch ? answers : [answers];
    const picked = groups.map((group) =>
      (Array.isArray(group) ? group : [])
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.replace(/\s+/g, " ").trim().slice(0, 80))
        .filter(Boolean),
    );
    if (!isBatch) {
      const single = picked[0] ?? [];
      return single.length > 0
        ? { title: "Stelow answer", detail: single.map((label) => `- ${label}`).join("\n").slice(0, 500) }
        : { title: "Stelow answer (skipped)" };
    }
    const answered = picked.filter((group) => group.length > 0).length;
    return {
      title: `Stelow answers (${answered} of ${picked.length})`,
      detail: picked
        .map((group, index) => `- Q${index + 1}: ${group.length > 0 ? group.join(", ") : "skipped"}`)
        .join("\n")
        .slice(0, 500),
    };
  } catch {
    return {};
  }
}
