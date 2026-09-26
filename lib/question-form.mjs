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
      // An option that inherited a sibling's document did not bring its own
      // evidence. Saying so is the difference between "here is the document
      // for THIS option" and "here is the same shared brief four times" —
      // which reads as broken and tells the reader nothing about what
      // distinguishes the options. Only true when there IS a shared brief to
      // have borrowed: an option with no document at all has nothing to
      // disclaim, and claiming otherwise would invent a shared brief.
      artifactInherited: own === null && artifact !== null,
    };
  });
}

function questionKind(raw) {
  return raw === "standard" || raw === "split" ? raw : undefined;
}

function questionItem(raw, id, title, fallbackPrompt) {
  return {
    id,
    title,
    prompt: typeof raw?.question === "string" ? raw.question : fallbackPrompt,
    multiple: raw?.multiple === true,
    kind: questionKind(raw?.kind),
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
