/**
 * A per-card spend budget, and the three things it may do when the card reaches it.
 *
 * There is no budget today, and the measured cost of a single card makes that the
 * largest unguarded thing in the product: one worker thread's own usage snapshot
 * reported 477,684 tokens, and using the context-window reading that ACP workers
 * send instead, the ten worker threads on this checkout ran between 87,296 and
 * 477,684 tokens each. Nothing anywhere compares that to a limit, so a card that
 * loops — a rework cycle, a worker that keeps re-reading, a recipe that spawns
 * more work than the stage needed — spends without a ceiling and without a signal.
 *
 * The rule is deliberately NOT "kill the card at the limit". A budget that stops
 * work silently is the phantom wait this project forbids: the person sees a card
 * that stopped and no question to answer. So there are two thresholds and two
 * different movements:
 *
 *   - `warn`  at a share of the budget: record it on the card's trail, keep going.
 *             The card is not blocked and nobody is paged; this is the signal that
 *             makes the next threshold not a surprise.
 *   - `ask`   at the budget: STOP and put a structured question on the card with
 *             the real numbers and named paths forward. The card waits for a person
 *             on purpose, which is a state the product already knows how to show.
 *
 * `null` budget is unlimited and is the default: a limit nobody chose is worse than
 * no limit, and every existing card has no budget.
 *
 * This module is pure: it decides, the caller records and projects.
 */

/** The movements a budget check can return, in escalation order. */
export const BUDGET_VERDICTS = Object.freeze(["unlimited", "ok", "warn", "ask"]);

/** The share of the budget at which the card warns without stopping. */
export const WARN_SHARE = 0.8;

/**
 * Whether a spend reading is usable.
 *
 * `null` is unknown and must never read as zero: a card whose usage cannot be read
 * has not spent nothing, and treating the two alike would let a broken reading
 * silently disable every budget.
 */
function usable(spent) {
  return typeof spent === "number" && Number.isFinite(spent) && spent >= 0;
}

/**
 * The budget verdict for one card.
 *
 * `budget` of `null`/`undefined`/non-positive means unlimited, and so does an
 * unreadable `spent` — but for a different `reason`, because "this card has no
 * budget" and "this card's spend could not be read" are different facts and an
 * operator has to be able to tell them apart.
 */
export function budgetVerdict({ spent, budget, warnShare = WARN_SHARE }) {
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) {
    return { verdict: "unlimited", reason: "no budget is set for this card", remaining: null, share: null };
  }
  if (!usable(spent)) {
    return {
      verdict: "unlimited",
      reason: "the card's spend could not be read, so no limit was applied — an unreadable figure is unknown, not zero",
      remaining: null,
      share: null,
    };
  }
  const share = spent / budget;
  const remaining = Math.max(0, budget - spent);
  if (spent >= budget) {
    return {
      verdict: "ask",
      reason: `the card has spent its budget (${spent.toLocaleString()} of ${budget.toLocaleString()} tokens)`,
      remaining,
      share,
    };
  }
  if (share >= warnShare) {
    return {
      verdict: "warn",
      reason: `${Math.round(share * 100)}% of the card's budget is spent (${spent.toLocaleString()} of ${budget.toLocaleString()} tokens)`,
      remaining,
      share,
    };
  }
  return { verdict: "ok", reason: null, remaining, share };
}

/**
 * The structured question the card asks when it reaches its budget.
 *
 * Written as the ask contract requires: a single clear question, options that
 * differ in what happens next, and evidence on each so a person can decide without
 * going looking. `spent` and `budget` are in the question text rather than only in
 * the option descriptions, because the number is the reason the question exists.
 */
export function budgetQuestion({ spent, budget, cardName }) {
  const options = [
    {
      label: "Raise the budget and continue",
      desc: `Continue this card with a higher ceiling. It has spent ${spent.toLocaleString()} of ${budget.toLocaleString()} tokens.`,
    },
    {
      label: "Continue unchanged",
      desc: "Keep working with the same budget. The card will ask again at the next threshold rather than stopping.",
    },
    {
      label: "Stop this card here",
      desc: `Leave the card where it is, with its artifacts and run records intact. Nothing is deleted.`,
    },
  ];
  return {
    question: `“${cardName}” has reached its token budget (${spent.toLocaleString()} of ${budget.toLocaleString()}). How should it continue?`,
    options,
    tag: "budget",
  };
}

/**
 * The trail line for a warn, or `null` for any other verdict.
 *
 * A warn leaves a record and no question, which is what makes it useful: the card
 * keeps working and a reader can see the ceiling approaching. `null` in, `null`
 * out, so a caller can call it unconditionally.
 */
export function budgetTrailLine(verdict, { spent, budget }) {
  if (verdict !== "warn") return null;
  return `Budget: ${Math.round((spent / budget) * 100)}% of this card's token budget is spent `
    + `(${spent.toLocaleString()} of ${budget.toLocaleString()}). The card continues; it will ask at the limit.`;
}
