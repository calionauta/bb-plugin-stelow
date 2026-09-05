/**
 * Batched question logic. Pure, no BB host dependency, so the grouping,
 * expansion, and answer-merging rules are exercised in tests.
 *
 * Context: `bb stelow ask` historically asked ONE question per blocking call,
 * so workers with N independent questions pinged the human N times (N inbox
 * events, N thread resumes, N fragmented answers). Batching works at two
 * levels:
 *
 * 1. At the source: the CLI accepts repeated `--question` groups in a single
 *    call and issues ONE requestInput interaction carrying
 *    `{ questions: [...] }`. The human answers everything in one sitting.
 * 2. On the card: every pending interaction (single or multi) is expanded
 *    into addressable sub-questions (`<interactionId>#<index>`) and answered
 *    atomically — one RPC, one worker continuation, one inbox resolution.
 *
 * A skipped question submits an empty answer array (for multiSelect that
 * already means "none"; for single-select the worker treats it as "no
 * preference, use your recommendation").
 */

export const QUESTION_ID_SEP = "#";

/**
 * Parse `bb stelow ask` argv into question groups. `--question` starts a new
 * group; `--option` appends to the current group; `--multiple` flags the
 * current group. `--thread` is consumed elsewhere and ignored here.
 * Returns `{ groups }` or `{ error }` (usage text, English).
 */
export function parseAskGroups(argv) {
  const groups = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--question") {
      const text = argv[i + 1];
      if (typeof text !== "string" || text.trim().length === 0) {
        return { error: "Each --question needs a non-empty text." };
      }
      groups.push({ question: text, multiple: false, options: [] });
      i++;
    } else if (arg === "--option") {
      const label = argv[i + 1];
      if (groups.length === 0) {
        return { error: "Options must follow a --question: --question <text> --option <label>..." };
      }
      if (typeof label !== "string" || label.trim().length === 0) {
        return { error: "Each --option needs a non-empty label." };
      }
      groups[groups.length - 1].options.push(label);
      i++;
    } else if (arg === "--multiple") {
      if (groups.length === 0) {
        return { error: "--multiple must follow a --question." };
      }
      groups[groups.length - 1].multiple = true;
    }
  }
  if (groups.length === 0) {
    return { error: "Usage: bb stelow ask --thread <thr_id> --question <text> [--multiple] --option <label>..." };
  }
  for (const [index, group] of groups.entries()) {
    if (group.options.length < 2) {
      return { error: `Question ${index + 1} needs at least 2 --option labels.` };
    }
  }
  return { groups };
}

function cleanOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      label: typeof entry.label === "string" ? entry.label : "",
      description: typeof entry.description === "string" ? entry.description : "",
    }))
    .filter((entry) => entry.label.length > 0);
}

/**
 * True when a requestInput payload carries a multi-question batch instead of
 * the legacy single-question shape.
 */
export function isBatchPayload(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.questions);
}

/**
 * Expand one pending interaction into addressable questions. Legacy
 * single-question payloads yield one entry whose questionId IS the
 * interaction id (backward compatible); batch payloads yield one entry per
 * sub-question with id `<interactionId>#<index>`. Malformed entries are
 * dropped, never thrown.
 */
export function expandInteractionQuestions(interaction) {
  const data = interaction !== null && typeof interaction === "object" && !Array.isArray(interaction)
    ? (interaction.payload !== null && typeof interaction.payload === "object" && !Array.isArray(interaction.payload)
      ? interaction.payload
      : {})
    : {};
  const dataRecord = data.data !== null && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : null;
  // Interactions created via bb.ui.requestInput carry the payload at top
  // level; be lenient and read questions/options from either level.
  const root = dataRecord ?? data;
  if (Array.isArray(root.questions)) {
    const out = [];
    root.questions.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
      const options = cleanOptions(entry.options);
      if (options.length === 0) return;
      out.push({
        questionId: `${interaction.id}${QUESTION_ID_SEP}${index}`,
        interactionId: interaction.id,
        index,
        title: typeof entry.title === "string" && entry.title ? entry.title : (interaction.title ?? "Question"),
        question: typeof entry.question === "string" ? entry.question : "",
        multiple: entry.multiple === true,
        options,
      });
    });
    return out;
  }
  const options = cleanOptions(root.options);
  if (options.length === 0) return [];
  return [{
    questionId: interaction.id,
    interactionId: interaction.id,
    index: 0,
    title: interaction.title ?? "Question",
    question: typeof root.question === "string" ? root.question : "",
    multiple: root.multiple === true,
    options,
  }];
}

/**
 * Split an expanded questionId back into its interaction id + sub-index.
 * Legacy ids (no separator) map to index 0.
 */
export function splitQuestionId(questionId) {
  const at = questionId.lastIndexOf(QUESTION_ID_SEP);
  if (at <= 0) return { interactionId: questionId, index: 0 };
  const index = Number(questionId.slice(at + 1));
  if (!Number.isInteger(index) || index < 0) return { interactionId: questionId, index: 0 };
  return { interactionId: questionId.slice(0, at), index };
}

/**
 * Group atomic card answers (`[{ questionId, answers }]`) by interaction so
 * the server responds exactly once per interaction. Single-question
 * interactions resolve to `{ kind: "single", answers }`; batch interactions
 * to `{ kind: "batch", answers }` where `answers` is a dense string[][] in
 * sub-question order (unanswered slots become []). Unknown/duplicate
 * questionIds collapse deterministically: first write wins per slot.
 */
export function groupBatchAnswers(items) {
  const byInteraction = new Map();
  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const { interactionId, index } = splitQuestionId(typeof item.questionId === "string" ? item.questionId : "");
    if (!interactionId) continue;
    const answers = Array.isArray(item.answers) ? item.answers.filter((a) => typeof a === "string") : [];
    let slot = byInteraction.get(interactionId);
    if (!slot) {
      slot = { single: null, slots: new Map() };
      byInteraction.set(interactionId, slot);
    }
    if (index === 0 && !item.questionId.includes(QUESTION_ID_SEP)) {
      if (slot.single === null) slot.single = answers;
    } else {
      if (!slot.slots.has(index)) slot.slots.set(index, answers);
    }
  }
  const out = new Map();
  for (const [interactionId, slot] of byInteraction) {
    if (slot.single !== null && slot.slots.size === 0) {
      out.set(interactionId, { kind: "single", answers: slot.single });
    } else {
      const max = Math.max(0, ...slot.slots.keys());
      const answers = [];
      for (let i = 0; i <= max; i++) answers.push(slot.slots.get(i) ?? []);
      if (slot.single !== null && answers.length > 0 && answers[0].length === 0) answers[0] = slot.single;
      out.set(interactionId, { kind: "batch", answers });
    }
  }
  return out;
}

/**
 * One worker continuation summarizing every answered question (English).
 * Atomic submit => exactly one thread.send => the worker resumes once.
 */
export function formatBatchContinuation(decisions) {
  const lines = decisions.map(({ question, answers }) => {
    const q = question && question.length > 0 ? question : "(untitled question)";
    const a = answers.length > 0 ? answers.join(", ") : "(skipped — use your recommendation)";
    return `Q: ${q}\nA: ${a}`;
  });
  return `The user answered ${decisions.length === 1 ? "the pending question" : `all ${decisions.length} pending questions at once`}. Continue the workflow now: persist the decisions, advance the appropriate stage with bb stelow advance, and keep working.\n\n${lines.join("\n\n")}`;
}
