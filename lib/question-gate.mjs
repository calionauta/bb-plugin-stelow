/**
 * Question gate: the single decision point for every ask refusal.
 * Merges ask-gate (dispatcher), question-presence (duplicate guard),
 * question-substance (placeholder floor), scope-ask-gate (scope shape),
 * context-ask-gate (explicit allow), ask-cancel (cancel policy).
 * Evidence verdict via question-evidence. Pure, no BB host dependency.
 * Precedence: duplicate, substance, scope shape, context, evidence.
 * `--force` bypasses scope shape/context/evidence, never duplicates and never
 * the substance floor.
 */
import { gateEvidenceGate } from "./question-evidence.mjs";

/**
 * The durable definition of an answerable question. A proposal row or a
 * worker's chat message is merely intent; it never blocks progress by itself.
 * Only a live interaction or a persisted recovery question is visible to the
 * person who can answer it.
 *
 * @param {{ liveInteractions: number, expiredQuestions: number }} counts
 * @returns {{ canOpen: boolean, reason: string | null }}
 */
export function questionOpenGuard({ liveInteractions, expiredQuestions }) {
  if (liveInteractions > 0) {
    return {
      canOpen: false,
      reason: "A structured question is already pending on this card. Wait for its card answer instead of asking again.",
    };
  }
  if (expiredQuestions > 0) {
    return {
      canOpen: false,
      reason: "An earlier question is still answerable on this card. Wait for its card answer instead of asking again.",
    };
  }
  return { canOpen: true, reason: null };
}

/**
 * Whether a question carries enough to ask a human.
 *
 * An ask is the one call that interrupts a person. `decideAskGate` refuses a
 * duplicate, a misplaced, or an evidence-free ask — but it had no floor on the
 * text itself, so any non-empty string reached a live interaction. Observed on
 * card_48uuhus1: a worker probing "is a question already pending?" ran
 * `bb stelow ask --question "ping" --option "a" --option "b"`, and the host
 * pinged the human with a nonsense form. The probe was the worker's, but
 * answering it was not the human's choice, so the gate refuses it.
 *
 * Deliberate placeholders are not measured: `decideAskGate` already refuses a
 * second ask while one is answerable, so checking that first is what actually
 * answers "is something pending?" — and it never interrupts anyone.
 */

const PLACEHOLDER_QUESTIONS = new Set([
  "ping",
  "test",
  "teste",
  "ok",
  "todo",
  "tbd",
  "n/a",
  "na",
  "none",
  "asdf",
  "foo",
  "bar",
  "baz",
  "lorem ipsum",
  "does this work",
  "are you there",
  "any update",
  "quick check",
]);

// A probe names its options "a" / "b". Short labels are NOT on their own
// suspect: "Yes"/"No" are the correct options at an Approve gate, and
// gate-ask-evidence already commits to label-only options keeping working.
const PLACEHOLDER_OPTIONS = new Set(["a", "b", "c", "d", "x", "y", "z", "1", "2", "3"]);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isPlaceholderQuestion(text) {
  const value = normalize(text);
  if (!value) return true;
  // ponytail: only empty text and a curated token list are refused. Length
  // alone cannot tell "ping" from "Approve?" — both are short, and the second
  // is a legitimate gate question. Detecting arbitrary nonsense is not
  // decidable here; add a token when a real probe shows up, not a heuristic.
  return PLACEHOLDER_QUESTIONS.has(value);
}

function isPlaceholderOption(label) {
  const value = normalize(label);
  if (!value) return true;
  return PLACEHOLDER_OPTIONS.has(value);
}

function groupOptions(group) {
  return Array.isArray(group?.options) ? group.options : [];
}

function optionLabel(option) {
  return option === null || typeof option !== "object" ? option : option.label;
}

/**
 * Decide whether the ask is worth a person's attention. Returns
 * { allowed, error }: a refusal names the fix and never dead-ends.
 *
 * Pure (no BB host dependency), so the whole shape matrix is exercised by
 * `tests/question-substance.test.mjs`. The floor is absolute: `--force` is
 * not consulted here and `decideAskGate` does not apply it either, because a
 * probe that can be forced through is a probe that will be. The only exit a
 * refusal offers is the real one — ask the real question, or read status
 * instead of asking.
 */
export function questionSubstanceGate({ groups }) {
  const list = Array.isArray(groups) ? groups : [];
  if (list.length === 0) {
    return {
      allowed: false,
      error:
        "Refused: this ask carries no question. Pass --question <text> with enough of it "
        + "that a person can answer it without reading the card first — a form with nothing "
        + "to answer interrupts a human who cannot tell it was an accident.",
    };
  }
  for (const group of list) {
    const question = String(group?.question ?? "");
    if (isPlaceholderQuestion(question)) {
      return {
        allowed: false,
        error:
          `Refused: "${question.trim() || "(empty)"}" is a placeholder, not a question — it `
          + "interrupts a human with nothing to answer. Ask the real question; if you are "
          + "checking whether one is already pending, do not ask at all — run `bb stelow status`.",
      };
    }
    const options = groupOptions(group);
    for (const option of options) {
      const label = String(optionLabel(option) ?? "");
      if (isPlaceholderOption(label)) {
        return {
          allowed: false,
          error:
            `Refused: option "${label.trim() || "(empty)"}" is too short to name a decision — `
            + "every option is read by a human who has to choose between them. Give each one a "
            + "label that says what choosing it means.",
        };
      }
    }
  }
  return { allowed: true, error: null };
}
// One tag for scope IN/OUT confirms, so the rule lives in one place.
//
// Scope questions are opt-out confirms (Pattern 3): keep-questions arrive
// with every option checked, add-questions with none, every group multiple,
// chunked at six. On card_a9q5zhzd the same shape arrived as "Keep IN ×7"
// unchecked plus "Add to IN ×4" as radio buttons — three deviations no test
// could name, because nothing marked a question AS a scope confirm. The tag
// is that mark: structural shape is enforced here, and in Auto the whole ask
// is refused (the worker adjusts scope itself and never parks).

/** The machine tag for scope IN/OUT confirms. */
export const SCOPE_ADJUST_TAG = "scope-adjust";

/** Pattern 3 chunks at six options per question; never drop items to fit. */
export const SCOPE_ASK_MAX_OPTIONS = 6;

import { askShapeRefusal } from "./ask-shape.mjs";

/**
 * The ask shape rules (count ceiling, recommendation marker) moved to
 * lib/ask-shape.mjs, re-exported here so every existing import keeps one home.
 */
export { SINGLE_SELECT_MAX_OPTIONS, askShapeRefusal } from "./ask-shape.mjs";

/**
 * Refuse a malformed scope confirm, or one asked in the wrong mode. Returns
 * the refusal sentence, or null when the ask may proceed. Pure, so the shape
 * the card enforces is pinned without standing up the CLI.
 *
 * `reviewMode` is the workflow's own label ("Auto", "Product Spec Gate",
 * ...); null/unknown fails open — a mode the host cannot read must never
 * block a question, or an unreadable state.md would silence real asks.
 */
export function scopeAskRefusal({ tag, reviewMode, groups }) {
  if (tag !== SCOPE_ADJUST_TAG) return null;
  // Canonical labels are capitalized ("Auto"), but the comparison is
  // case-insensitive on purpose: a lowercase "auto" in state.md evidently
  // means Auto, while an unrecognized label stays unknown and fails open.
  if (typeof reviewMode === "string" && reviewMode.trim().toLowerCase() === "auto") {
    return "Refused: review mode is Auto, where the worker adjusts scope itself and never parks waiting — "
      + "decide which scopes stay IN and proceed (Pattern 3). Re-run with --force to ask anyway.";
  }
  const list = Array.isArray(groups) ? groups : [];
  for (const [index, group] of list.entries()) {
    if (!group || group.multiple !== true) {
      return `Refused: scope question ${index + 1} is single-select — scope confirms are opt-out multi-selects, `
        + "re-run with --multiple so keeping means leaving checked.";
    }
    const count = Array.isArray(group.options) ? group.options.length : 0;
    if (count > SCOPE_ASK_MAX_OPTIONS) {
      return `Refused: scope question ${index + 1} carries ${count} options over the ${SCOPE_ASK_MAX_OPTIONS} maximum — `
        + "split into batched groups in one call, all preselected, never drop scopes to fit.";
    }
  }
  const checked = list.flatMap((group) => Array.isArray(group?.options) ? group.options : [])
    .some((option) => option?.selected === true);
  if (!checked) {
    return "Refused: no scope option starts checked — scope confirms are opt-out, "
      + "mark every keep option --selected so keeping means doing nothing.";
  }
  return null;
}

/**
 * Decide whether an ask may reach the human. Returns { allowed, reason,
 * code }: the first refusal in pipeline order wins; all green returns
 * allowed. Exit codes preserve the handler's contract (1 = transient,
 * retry the same ask once; 2 = refused, do not retry blindly). Pure (no
 * BB host dependency) so the precedence matrix is exercised in node
 * tests. `--force` bypasses the evidence gate but never the duplicate guard
 * — a second form while one is answerable is a duplicate regardless of
 * flags — and never the substance floor, because a probe that can be forced
 * through is a probe that will be.
 *
 * There is one decision point for every ask refusal. The ask handler used to
 * run three gates inline (duplicate, intent, evidence) plus a split branch;
 * reordering or editing one risked silently changing the precedence the
 * others relied on, so the order is fixed here: duplicate, substance, scope
 * shape, evidence. The split branch stays out deliberately: it validates AND
 * persists (split_proposals row, question rewrite), and a dispatcher decides
 * but never executes.
 *
 * There is no intent gate. Upstream `context:5` permits a reduced opt-in ask
 * for refactor/bugfix when the baseline is verifiable, and this host cannot
 * read that predicate, so an intent gate here would refuse a path it cannot
 * distinguish from the permitted one. `intent` stays in the input because
 * the CLI and handler pass it, but nothing gates on it.
 */
export function decideAskGate({ liveCount, expiredCount, kind, stage, tag, forced, groups, reviewMode }) {
  const duplicate = questionOpenGuard({ liveInteractions: liveCount ?? 0, expiredQuestions: expiredCount ?? 0 });
  if (!duplicate.canOpen) return { allowed: false, reason: duplicate.reason, code: 1 };
  // The substance floor is enforced outside the `forced` branch on purpose: a
  // probe that can be forced through is a probe that will be, and the human it
  // interrupts cannot tell the form was forced. The gates below stay
  // overridable because they encode a judgment about a real ask.
  const substance = questionSubstanceGate({ groups });
  if (!substance.allowed) return { allowed: false, reason: substance.error, code: 2 };
  if (!forced) {
    // Scope confirms carry their shape as a tag, not as prose to classify:
    // the gate reads the tag and the workflow's own mode label, never the
    // question text. Unknown modes fail open — an unreadable state must not
    // silence a real ask.
    const scope = scopeAskRefusal({ tag, reviewMode, groups });
    if (scope) return { allowed: false, reason: scope, code: 2 };
    // Shape rules are authority-free: a radio with too many rows, or a
    // one-choice question recommending several of its own options, is
    // malformed whoever asked and in whatever mode (issue #384). Runs after
    // the substance floor so an empty option list still reports the reason a
    // reader can act on first.
    const shape = askShapeRefusal({ groups });
    if (shape) return { allowed: false, reason: shape, code: 2 };
  }
  const evidence = gateEvidenceGate({ kind, stage, tag, forced, groups });
  if (!evidence.allowed) return { allowed: false, reason: evidence.error, code: 2 };
  return { allowed: true, reason: null, code: 0 };
}

/* ---- merged from lib/question-gate.mjs ---- */
/**
 * Ask-cancellation policy. Pure logic, no BB host dependency, so the full
 * cancel-reason matrix is exercised in tests.
 *
 * Context: `bb stelow ask` blocks on a host interaction. When the wait ends
 * without an answer, the question must persist (expired_questions +
 * awaiting-answer) for infrastructure reasons (the user never saw it), and
 * pass through for explicit end states (the human or the thread ended it).
 * Getting this wrong silently loses decisions — as happened when a plugin
 * reload cancelled a gate approval with reason `plugin-disposed`.
 */

export const TRANSIENT_CANCEL_REASONS = ["timeout", "plugin-disposed", "server-restarted", "request-aborted"];

/**
 * Returns "persist" when a cancelled ask must be recorded as still-pending,
 * "passthrough" when the worker should simply see the cancellation.
 * A request that threw before returning counts as transient (the user
 * never saw the question either).
 */
export function classifyAskCancel(outcome, reason, requestFailed = false) {
  if (requestFailed) return "persist";
  if (outcome !== "cancelled" || reason == null) return "passthrough";
  return TRANSIENT_CANCEL_REASONS.includes(reason) ? "persist" : "passthrough";
}

/**
 * Worker-facing explanation for a persisted interruption. Never claims the
 * user is away when the infrastructure dropped the question instead.
 */
export function interruptionWhy(reason, requestFailed, elapsedSecs) {
  if (requestFailed) return "The question request failed before delivery.";
  if (reason === "timeout") return `No response after ${elapsedSecs}s — the user is away.`;
  const cause = reason === "plugin-disposed" ? "plugin reload" : reason;
  return `The question was interrupted by a ${cause} after ${elapsedSecs}s — the user never saw it.`;
}

/**
 * Whether a failed persist attempt is worth exactly one retry after a short
 * backoff. Only lock contention qualifies: a closed/missing DB, a readonly
 * filesystem, or a schema mismatch will fail identically on retry, so
 * retrying would only delay the honest re-ask-once message to the worker.
 */
export function isRetryablePersistError(message) {
  const text = String(message ?? "");
  return text.includes("SQLITE_BUSY") || text.includes("database is locked");
}
