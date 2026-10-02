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
 * `tests/question-substance.test.mjs`. `--force` is deliberately NOT
 * consulted here — the caller applies it — because a probe that can be
 * forced through is a probe that will be.
 */
export function questionSubstanceGate({ groups }) {
  const list = Array.isArray(groups) ? groups : [];
  if (list.length === 0) {
    return {
      allowed: false,
      error:
        "Refused: this ask carries no question. Pass --question <text> with enough of it "
        + "that a person can answer it without reading the card first, or re-run with "
        + "--force to override this floor.",
    };
  }
  for (const group of list) {
    const question = String(group?.question ?? "");
    if (isPlaceholderQuestion(question)) {
      return {
        allowed: false,
        error:
          `Refused: "${question.trim() || "(empty)"}" is a placeholder, not a question — it `
          + "interrupts a human with nothing to answer. Ask the real question, or, if you are "
          + "checking whether one is already pending, do not ask: run `bb stelow status` and "
          + "re-run with --force to override this floor.",
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
            + "label that says what choosing it means, or re-run with --force to override.",
        };
      }
    }
  }
  return { allowed: true, error: null };
}