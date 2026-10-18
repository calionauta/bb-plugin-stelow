/**
 * Shared presentation policy for card and thread questions.
 *
 * Structured questions are product UI, so their host-authored copy is always
 * English. Workers must author their question and option text in English too;
 * the renderer never guesses or translates arbitrary user content.
 */

const COPY = {
  en: {
    // The counters (answerNeeded / answersNeeded / batchProgress /
    // answersRemaining / pickOneOrMore) were deleted with the panel frame on
    // 2026-10-18: every one of them restated a fact the hero's state line or
    // the step dots already carry. What is left is copy that names something
    // the reader cannot derive — the control labels, the skip consequence, and
    // the refusal reason.
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

// The card's ONE prose-truncation rule, shared by the card's own description
// and by an option's glance. It replaced a 240-character limit applied to option
// descriptions only, while the card's own request rendered in full between the
// state line and the question it produced. The reasoning — why a first sentence,
// and what "over the limit" must always do — is in
// tests/question-presentation.test.mjs, next to the assertions it explains.
export const PROSE_SUMMARY_LIMIT = 140;

/** End of the first sentence within `window`, or -1 when none is complete. */
function firstSentenceEnd(window) {
  const match = window.match(/[.!?](?:["')\]\u201d\u2019]|\s|$)/);
  return match ? match.index + match[0].length : -1;
}

/** The visible head of a long passage, plus the tail a disclosure reveals. */
export function splitProseSummary(text, limit = PROSE_SUMMARY_LIMIT) {
  if (typeof text !== "string" || text.length <= limit) {
    return { head: typeof text === "string" ? text : "", tail: null };
  }
  const window = text.slice(0, limit);
  const sentenceEnd = firstSentenceEnd(window);
  // A sentence boundary wins only when it leaves a real summary behind: a
  // numbered or abbreviated lead ("1. Land the schema…", "e.g. the pin is
  // stale…") puts a terminator 2-4 characters in, and honouring it hands the
  // reader a head of "1." that hides the request for no reason. "At least two
  // words" is exactly what an abbreviation's dot fails and "Do it." passes.
  const candidate = sentenceEnd > 0 ? text.slice(0, sentenceEnd).trim() : "";
  if (/\s/.test(candidate)) {
    return { head: candidate, tail: text.slice(sentenceEnd).trimStart() };
  }
  const breakAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
  if (breakAt > limit / 2) {
    return { head: text.slice(0, breakAt).trimEnd(), tail: text.slice(breakAt).trimStart() };
  }
  // No usable break: prefer the next whitespace so the head keeps the whole
  // token. Unbreakable input takes a hard cut, so over-limit always has a door.
  const nextSpace = text.slice(limit).search(/\s/);
  if (nextSpace > 0) {
    const cut = limit + nextSpace;
    return { head: text.slice(0, cut).trimEnd(), tail: text.slice(cut).trimStart() };
  }
  return { head: text.slice(0, limit).trimEnd(), tail: text.slice(limit) };
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

/* ---- merged from lib/question-presentation.mjs ---- */
import { SPLIT_KEEP_LABEL } from "./split-proposal.mjs";

export const SPLIT_QUESTION_GUIDANCE = "Select one or more deliveries to create independent cards. "
  + "Anything you leave unselected remains in this card. "
  + "If you select every delivery, this card is archived after the new cards are created.";

const LEGACY_PROMPTS = [
  SPLIT_QUESTION_GUIDANCE,
  "Select the deliveries that should become new independent cards. "
    + "Anything you do not select stays in this card; nothing is discarded. "
    + "Choose \"Keep as one card\" to keep the entire request together.",
  "Select any deliveries to move into separate cards. Work you leave unselected stays in this card.",
];
const GENERATED_OPTION_SUFFIX = new RegExp(
  "\\n\\n(?:Selecting this creates one independent card for this delivery; "
    + "unselected deliveries remain in this card\\.|Keep the complete request in this card\\. "
    + "No new cards will be created\\.|Creates one independent card for this delivery\\.|"
    + "Keep every delivery in this card\\. No new cards will be created\\.)\\s*$",
);

export function isSplitQuestion(question) {
  // `kind` is the forward-compatible semantic discriminator. The option
  // fallback keeps already-persisted questions safe after an upgrade.
  return question?.kind === "split" || (Boolean(question?.multiple) && Array.isArray(question?.options)
    && question.options.some((option) => option?.label === SPLIT_KEEP_LABEL));
}

// A previously persisted ask must render with current, non-duplicated copy.
// Keep the worker's original question but replace only the host-generated
// ending; author-written paragraphs are never flattened or removed.
export function splitQuestionText(question) {
  let base = typeof question === "string" ? question.trim() : "";
  for (const legacy of LEGACY_PROMPTS) {
    if (base.endsWith(legacy)) base = base.slice(0, -legacy.length).trim();
  }
  return base ? `${base}\n\n${SPLIT_QUESTION_GUIDANCE}` : SPLIT_QUESTION_GUIDANCE;
}

export function splitOptionDescription(description) {
  return (typeof description === "string" ? description : "").replace(GENERATED_OPTION_SUFFIX, "");
}

// Feedback belongs beside the selection that changes the parent-card fate,
// not only in static explanatory copy above the options.
export function splitSelectionNotice(options, selected) {
  const deliveries = (Array.isArray(options) ? options : [])
    .map((option) => option?.label)
    .filter((label) => typeof label === "string" && label !== SPLIT_KEEP_LABEL);
  const picks = new Set((Array.isArray(selected) ? selected : []).filter((label) => typeof label === "string"));
  if (picks.has(SPLIT_KEEP_LABEL)) {
    return { kind: "keep", text: "Keeping one card: no child cards will be created and this card stays active." };
  }
  const selectedDeliveries = deliveries.filter((label) => picks.has(label));
  if (selectedDeliveries.length === 0) return null;
  if (deliveries.length > 0 && selectedDeliveries.length === deliveries.length) {
    return {
      kind: "archive",
      text: `All ${deliveries.length} deliveries are selected. `
        + `Submitting will create ${deliveries.length} child cards and archive this card.`,
    };
  }
  return {
    kind: "partial",
    text: `${selectedDeliveries.length} ${selectedDeliveries.length === 1 ? "delivery" : "deliveries"} `
      + "will become child cards; this card stays active with the remaining work.",
  };
}

/* ---- merged from lib/question-presentation.mjs ---- */
import { inheritAskArtifact, normalizeAskArtifactPath } from "./question-batch.mjs";

function genericTitle(title) {
  return /^stelow questions?(?: \(\d+\))?$/i.test(title ?? "") ? "" : title;
}

function threadArtifact(raw) {
  const path = typeof raw === "string"
    ? raw
    : raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? raw.path
      : undefined;
  const normalized = normalizeAskArtifactPath(path);
  return normalized
    ? { ...normalized, absolutePath: null, hostId: null }
    : null;
}

function threadOptions(raw) {
  const list = Array.isArray(raw)
    ? raw
      .filter((option) => (
        option !== null
        && typeof option === "object"
        && !Array.isArray(option)
        && typeof option.label === "string"
      ))
      .map((option) => ({
        label: option.label,
        description: typeof option.description === "string" ? option.description : "",
        preview: typeof option.preview === "string" ? option.preview : null,
        artifact: threadArtifact(option.artifact),
        // Sparse like cleanOptions on the card path: an explicit true
        // travels, absence reads as unchecked / submittable. Both renderers
        // feed the same stepper, so the two mappings can never disagree on
        // what a flag means — a conditional pick or opt-out confirm dropped
        // here would silently render as a plain pick in the thread.
        ...(option.selected === true ? { selected: true } : {}),
        ...(option.needsNote === true ? { needsNote: true } : {}),
      }))
    : [];
  const inherited = inheritAskArtifact(list);
  return list.map((option, index) => {
    const own = option.artifact;
    const artifact = own ?? inherited[index];
    return {
      ...option,
      artifact: artifact
        ? { ...artifact, absolutePath: null, hostId: null }
        : null,
      // Same rule the card path applies in resolveAskOptions: a document
      // that was borrowed rather than attached is marked, because one
      // document on four rows otherwise reads as four pieces of evidence
      // about four different options. Only true when there IS a document to
      // have borrowed — an option with none has nothing to disclaim, and
      // claiming otherwise would invent a shared brief nobody attached.
      artifactInherited: own === null && artifact !== null,
    };
  });
}

function formQuestionKind(raw) {
  return raw === "standard" || raw === "split" ? raw : undefined;
}

function questionItem(raw, id, title, fallbackPrompt) {
  return {
    id,
    title,
    prompt: typeof raw?.question === "string" ? raw.question : fallbackPrompt,
    multiple: raw?.multiple === true,
    kind: formQuestionKind(raw?.kind),
    options: threadOptions(raw?.options),
  };
}

/** Normalize a pending interaction for the shared batch stepper. */
export function questionFormItems(interaction) {
  const payload = interaction.payload !== null
    && typeof interaction.payload === "object"
    && !Array.isArray(interaction.payload)
    ? interaction.payload
    : {};
  const title = genericTitle(interaction.title);
  if (Array.isArray(payload.questions) && payload.questions.length > 0) {
    return payload.questions
      .map((question, index) => questionItem(question, `q${index}`, title, ""))
      .filter((question) => question.options.length > 0);
  }
  const item = questionItem(payload, "q0", title, interaction.title);
  return item.options.length > 0 ? [item] : [];
}

/** Keep the host payload contract unchanged: one question is flat, batches nest. */
export function questionFormSubmission(answers, batched) {
  return { answers: batched ? answers : answers[0] ?? [] };
}

/** Bind host completion callbacks without changing their promise semantics. */
export function questionFormActions(submit, cancel) {
  return {
    submit(answers, batched) {
      return submit(questionFormSubmission(answers, batched));
    },
    cancel,
  };
}
