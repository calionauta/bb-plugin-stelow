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
    batchProgress: (done, total, canSkip) => `${done} of ${total} answered${canSkip ? " (skipped counts as answered)" : ""}. ${canSkip ? "One submit sends everything at once." : "Only answered questions are sent; the rest stay open."}`,
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
