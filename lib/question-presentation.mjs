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
    other: "Note — or your own answer instead",
    customPlaceholder: "Add context for your pick, or answer in your own words…",
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

// Long option descriptions bury the decision: four options at 150+
// characters each is a wall nobody reads before picking. Past the preview
// limit the description collapses behind a disclosure; the full text stays
// one click away, mirroring the preview policy in batch-options.tsx.
export const OPTION_DESCRIPTION_PREVIEW_LIMIT = 240;

export function splitOptionDescriptionPreview(description, limit = OPTION_DESCRIPTION_PREVIEW_LIMIT) {
  if (typeof description !== "string" || description.length <= limit) {
    return { head: typeof description === "string" ? description : "", tail: null };
  }
  const window = description.slice(0, limit);
  const breakAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
  const cut = breakAt > limit / 2 ? breakAt : limit;
  return { head: description.slice(0, cut).trimEnd(), tail: description.slice(cut).trimStart() };
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

/**
 * The one brief behind a question, when there is exactly one.
 *
 * Gate approvals attach the same document to every option (or the host
 * inherits it onto all of them), so N per-row Open buttons open N copies
 * of one file — friction and confusion for zero information. When every
 * option carries the same document, the question embeds one reader instead
 * of repeating the button; genuinely different documents keep their
 * per-row buttons. Identity is the resolved path (absolutePath wins),
 * because two spellings of one file are still one file. Anything
 * ambiguous — no options, a missing document, mixed documents — returns
 * null and the rows render as before.
 */
export function sharedQuestionArtifact(options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const docs = options.map((option) =>
    option && typeof option === "object" ? option.artifact ?? null : null);
  if (docs.some((doc) => !doc)) return null;
  const identity = (doc) => doc.absolutePath || doc.path;
  const first = identity(docs[0]);
  if (!first || !docs.every((doc) => identity(doc) === first)) return null;
  return docs[0];
}

/**
 * Which viewer mode an option's document opens in, from the option label.
 *
 * An approval is a decision after reading, not a request to alter the
 * document. All other choices — especially Request/Review changes — keep
 * the full quote-and-comment path to communicate precise feedback.
 */
export function artifactViewerModeForOption(label) {
  return /\b(approve|accept|proceed)\b/i.test(typeof label === "string" ? label : "") ? "review" : "comment";
}

/**
 * Why submit must wait, or null when the batch may go.
 *
 * A conditional option (needsNote) is a promise the answers alone cannot
 * keep: "trim the scope" without the which, "rework" without the what.
 * The note box is where the missing piece lives, so a picked conditional
 * option with an empty note blocks the submit instead of shipping a
 * guaranteed clarification round. Anything else — plain approves, notes
 * present, unpicked conditionals, skips (whose picks are already cleared)
 * — passes. Pure over caller-owned state, so both the footer gate and the
 * per-question hint read one rule and can never disagree.
 */
export function submitBlockReason(questions, selected, custom) {
  const list = Array.isArray(questions) ? questions : [];
  const picks = selected !== null && typeof selected === "object" && !Array.isArray(selected) ? selected : {};
  const notes = custom !== null && typeof custom === "object" && !Array.isArray(custom) ? custom : {};
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const labels = Array.isArray(picks[entry.id]) ? picks[entry.id] : [];
    const text = typeof notes[entry.id] === "string" ? notes[entry.id].trim() : "";
    if (text.length > 0) continue;
    const missing = (Array.isArray(entry.options) ? entry.options : [])
      .some((option) => option && option.needsNote === true && labels.includes(option.label));
    if (missing) return "This pick needs a note — say what should change, then submit.";
  }
  return null;
}
