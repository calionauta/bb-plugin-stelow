/**
 * Shared presentation policy for card and thread questions.
 *
 * The worker explicitly chooses a question locale. English is the default;
 * matching a user's other language is an intentional LLM decision recorded
 * on the interaction, not a UI guess from arbitrary option text. The content
 * fallback exists only for interactions created before locale was stored.
 */

const PORTUGUESE_SIGNAL = /\b(qual(?:is)?|solicita(?:ç|c)ão|entreg(?:a|á)veis?|permanecer|cart(?:ão|ao|ões|oes)|selecion(?:e|ar|ado)|resposta|trabalho|nenhum|prazo|você|voce|não|nao|refatorar|decompor|frontend|backend)\b|[áàâãéêíóôõúç]/i;

function legacyQuestionLocale(question, options = []) {
  const text = [question, ...(Array.isArray(options) ? options.map((option) => option?.label ?? "") : [])]
    .filter((value) => typeof value === "string")
    .join("\n");
  return PORTUGUESE_SIGNAL.test(text) ? "pt-BR" : "en";
}

export function questionLocale(rawLocale, legacyQuestion, options = []) {
  if (rawLocale === "pt-BR" || rawLocale === "en") return rawLocale;
  return legacyQuestionLocale(legacyQuestion, options);
}

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
    recoveryHeading: "Your decision is still needed",
    recoveryBody: "The original request was interrupted before you answered. There is no deadline: this decision stays here until you answer or archive the card. Your answer resumes the workflow.",
  },
  "pt-BR": {
    answerNeeded: "Sua resposta é necessária",
    answersNeeded: (count) => `${count} perguntas precisam da sua resposta`,
    questionOf: (current, total) => `Pergunta ${current} de ${total}`,
    questions: "Perguntas",
    answered: "respondidas",
    other: "Outra resposta — escreva com suas palavras",
    customPlaceholder: "Escreva sua resposta…",
    skipped: "Ignorada — responder mesmo assim",
    skip: "Ignorar — deixar a IA usar a recomendação dela",
    submitAnswer: "Enviar resposta",
    submitAnswers: "Enviar respostas",
    sending: "Enviando…",
    back: "Voltar",
    next: "Próxima",
    continue: "Continuar",
    continueWithAnswers: (count) => `Continuar com ${count} respostas`,
    batchProgress: (done, total, canSkip) => `${done} de ${total} respondidas${canSkip ? " (ignorar conta como respondida)" : ""}. ${canSkip ? "Um único envio manda todas de uma vez." : "Somente as perguntas respondidas serão enviadas; as outras continuam abertas."}`,
    pickOneOrMore: "Escolha uma ou mais opções e envie.",
    recoveryHeading: "Sua decisão ainda é necessária",
    recoveryBody: "A solicitação original foi interrompida antes da sua resposta. Não há prazo: esta decisão continua aqui até você responder ou arquivar o card. Sua resposta retoma o trabalho.",
  },
};

export function questionCopy(locale) {
  return COPY[locale === "pt-BR" ? "pt-BR" : "en"];
}
