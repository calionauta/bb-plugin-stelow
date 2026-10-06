import assert from "node:assert/strict";
import { BUDGET_VERDICTS, WARN_SHARE, budgetQuestion, budgetTrailLine, budgetVerdict } from "../lib/card-budget.mjs";

/**
 * The budget rule: when a card warns, when it asks, and never a silent stop.
 *
 * This is the largest unguarded thing the cost measurements found. There is no
 * budget column on a card at all, and the measured spend makes that expensive: one
 * worker thread's own usage snapshot reported 477,684 tokens, and the ten worker
 * threads on this checkout ran between 87,296 and 477,684 tokens each. A card that
 * loops has no ceiling and no signal.
 *
 * The rule is deliberately not "stop at the limit". A budget that ends work
 * silently is the phantom wait this project forbids — a card that stopped with no
 * question to answer — so reaching the budget is an ASK with the real numbers and
 * three named paths, and the warn threshold exists so the ask is never a surprise.
 */

const budget = 100_000;
const at = (spent) => budgetVerdict({ spent, budget });

// --- 1. The three bands, at their boundaries. --------------------------------
assert.equal(at(0).verdict, "ok", "an untouched card is fine");
assert.equal(at(79_999).verdict, "ok", "just under the warning band is still fine");
assert.equal(at(80_000).verdict, "warn", "exactly at the warn share warns — the boundary belongs to the band above it");
assert.equal(at(99_999).verdict, "warn", "just under the budget still warns rather than asking");
assert.equal(at(100_000).verdict, "ask", "exactly at the budget asks, not warns");
assert.equal(at(500_000).verdict, "ask", "and spending past it stays an ask, never a silent stop");

// The boundary is asserted rather than assumed, because a warn that fires at 80.1%
// is an off-by-one nobody notices until a card asks earlier than the docs say.
assert.equal(WARN_SHARE, 0.8, "the warn share is stated once and pinned");

// --- 2. Warn records and does not block; ask asks. ---------------------------
const warn = at(85_000);
assert.equal(warn.verdict, "warn", "85% warns");
assert.match(warn.reason, /85% of the card's budget/, "the warning names the share in the reason a reader sees");
assert.equal(warn.remaining, 15_000, "and the remaining budget, so the next step is legible");
assert.equal(
  budgetTrailLine("warn", { spent: 85_000, budget }),
  "Budget: 85% of this card's token budget is spent (85,000 of 100,000). "
    + "The card continues; it will ask at the limit.",
  "a warn leaves a trail line that says the card continues — a warn that blocked would be a silent stop with extra steps",
);
assert.equal(budgetTrailLine("ok", { spent: 1, budget }), null, "an ordinary reading leaves no trail line");
assert.equal(budgetTrailLine("ask", { spent: budget, budget }), null, "the ask is recorded by the question, not by a trail line — one fact, one home");
assert.equal(budgetTrailLine("unlimited", { spent: 1, budget }), null, "an unlimited card leaves no trail line");

const ask = at(120_000);
assert.equal(ask.verdict, "ask", "past the budget asks");
assert.equal(ask.remaining, 0, "remaining is zero rather than negative — a card cannot have spent more than its budget in the sense of having any left");
assert.ok(ask.share > 1, "but the share stays truthful above 1, so a big overrun reads as a big overrun");

// --- 3. The ask is answerable: one question, three distinct paths, evidence. --
const q = budgetQuestion({ spent: 120_000, budget, cardName: "Add a read-only Scope Map view" });
assert.equal(typeof q.question, "string", "the ask is a single question");
assert.ok(q.question.includes("120,000") && q.question.includes("100,000"), "the question carries both numbers, because the number is why it exists");
assert.ok(q.question.includes("Add a read-only Scope Map view"), "and names the card, so the person knows what they are deciding about");
assert.equal(q.options.length, 3, "three paths forward");
assert.equal(new Set(q.options.map((o) => o.label)).size, 3, "and they are distinct labels");
for (const option of q.options) {
  assert.ok(option.desc.length > 20, `every option explains what it does: ${option.label}`);
}
assert.ok(
  q.options.some((o) => /Nothing is deleted/.test(o.desc)),
  "the option that stops the card says explicitly that nothing is destroyed — the person is choosing where to leave it, not what to lose",
);
assert.equal(q.tag, "budget", "the ask is tagged, so the card can group and resolve it per kind");

// --- 4. No budget, and unreadable spend, are different facts. ---------------
// Both are unlimited, and the REASON is what keeps them apart: "this card has no
// budget" is a configuration fact, "this card's spend could not be read" is a bug.
const none = budgetVerdict({ spent: 5000, budget: null });
assert.equal(none.verdict, "unlimited", "no budget is unlimited");
assert.match(none.reason, /no budget is set/, "and says so as a configuration fact");
assert.equal(none.share, null, "an unlimited card has no share to report");

for (const spent of [null, undefined, Number.NaN, -1, "5000"]) {
  const unreadable = budgetVerdict({ spent, budget });
  assert.equal(
    unreadable.verdict,
    "unlimited",
    `an unreadable spend (${JSON.stringify(spent)}) applies no limit rather than reading as zero`,
  );
  assert.match(
    unreadable.reason,
    /could not be read/,
    `and the reason distinguishes it from a card with no budget — got ${unreadable.reason}`,
  );
}

// The zero-versus-unknown rule, from the other edge: a measured zero is a reading.
const zero = budgetVerdict({ spent: 0, budget });
assert.equal(zero.verdict, "ok", "a card that has really spent zero is fine, not unknown");
assert.equal(zero.share, 0, "and its share is zero");

// --- 5. A zero or negative budget is not a limit. ---------------------------
// A budget of 0 would mean "ask immediately, forever", which is a trap rather than
// a policy; it is treated as unset so a bad config cannot brick every card.
for (const bad of [0, -1, Number.NaN]) {
  const d = budgetVerdict({ spent: 10, budget: bad });
  assert.equal(d.verdict, "unlimited", `a budget of ${JSON.stringify(bad)} is treated as unset rather than as an instant stop`);
}

// --- 6. The verdict vocabulary is closed. -----------------------------------
assert.deepEqual(
  [...BUDGET_VERDICTS],
  ["unlimited", "ok", "warn", "ask"],
  "the four verdicts are the whole vocabulary, so nothing downstream can meet an unknown one",
);
for (const spent of [0, 50_000, 85_000, 120_000]) {
  assert.ok(BUDGET_VERDICTS.includes(at(spent).verdict), `${spent} produces a declared verdict`);
}

// --- 7. Escalation is monotone in spend. ------------------------------------
// A higher spend must never produce a weaker verdict, which is the property that
// makes the thresholds safe to tune without re-reading this file.
const order = { unlimited: -1, ok: 0, warn: 1, ask: 2 };
let previous = -1;
for (const spent of [0, 10_000, 79_999, 80_000, 99_999, 100_000, 1_000_000]) {
  const rank = order[at(spent).verdict];
  assert.ok(rank >= previous, `spend ${spent} does not weaken the verdict (${at(spent).verdict} after rank ${previous})`);
  previous = rank;
}

console.log(
  `card budget ok: bands ok/warn/ask at ${WARN_SHARE * 100}%/100% · ` +
    "unreadable spend and no budget are both unlimited but for different reasons · reaching the limit asks, never stops silently",
);
