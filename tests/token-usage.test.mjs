import assert from "node:assert/strict";
import {
  contextUsageFromEvents,
  formatTokenUsage,
  sumTokenBreakdowns,
  tokenBreakdownFromEvents,
  tokenUsageFromEvents,
  totalTokenUsage,
  totalUsageProvenance,
  usageFromEvents,
} from "../lib/token-usage.mjs";

const event = (total) => ({ type: "thread/tokenUsage/updated", data: { tokenUsage: { total: { totalTokens: total } } } });

assert.equal(tokenUsageFromEvents([event(1234)]), 1234, "uses BB's provider-reported total");
assert.equal(tokenUsageFromEvents([{ type: "turn/completed", data: {} }, event(99)]), 99, "ignores unrelated events");
assert.equal(tokenUsageFromEvents([]), null, "no provider report stays hidden, never zero");
assert.equal(tokenUsageFromEvents([event(-1)]), null, "invalid provider totals stay hidden");
assert.equal(formatTokenUsage(1234), "1.2K", "formats a visible provider total");
assert.equal(formatTokenUsage(null), null, "does not format absent usage");
assert.equal(totalTokenUsage([{ tokenUsage: 100 }, { tokenUsage: null }, { tokenUsage: 50, children: [{ tokenUsage: 25 }, { tokenUsage: null }] }]), 175, "threads and children sum, unknowns skip");
assert.equal(totalTokenUsage([{ tokenUsage: null }, { children: [{ tokenUsage: null }] }]), null, "all-unknown resolves null, never zero");
assert.equal(totalTokenUsage([]), null, "empty history resolves null");
assert.equal(totalTokenUsage(null), null, "junk resolves null");

const usageEvent = (total) => [{ type: "thread/tokenUsage/updated", data: { tokenUsage: { total } } }];
// The full provider split survives: input, output, cached (cached +
// cache-read), reasoning, total. Omitted legs stay null — a partial
// report never fabricates them.
assert.deepEqual(
  tokenBreakdownFromEvents(usageEvent({ inputTokens: 800, outputTokens: 300, cachedInputTokens: 100, cacheReadInputTokens: 50, reasoningOutputTokens: 20, totalTokens: 1270 })),
  { input: 800, output: 300, cached: 150, reasoning: 20, total: 1270 },
  "all legs parse, cached sums both cache fields",
);
assert.deepEqual(
  tokenBreakdownFromEvents(usageEvent({ inputTokens: 800, totalTokens: 900 })),
  { input: 800, output: null, cached: null, reasoning: null, total: 900 },
  "omitted legs resolve null",
);
assert.equal(tokenBreakdownFromEvents([]), null, "no events resolves null");
assert.equal(tokenBreakdownFromEvents(usageEvent({})), null, "empty totals resolve null");
// Card-level sums stay per-leg: legs nobody reported stay null, and an
// all-unknown card resolves null instead of a zero that would lie.
assert.deepEqual(
  sumTokenBreakdowns([
    { input: 800, output: 300, cached: null, reasoning: 20, total: 1120 },
    { input: 200, output: null, cached: 100, reasoning: null, total: null },
  ]),
  { input: 1000, output: 300, cached: 100, reasoning: 20, total: 1120 },
  "legs sum independently, unknowns skip per leg",
);
assert.equal(sumTokenBreakdowns([{ input: null, output: null, cached: null, reasoning: null, total: null }]), null, "all-unknown resolves null");
assert.equal(sumTokenBreakdowns([]), null, "empty resolves null");

// --- A summed total knows what it is made of. --------------------------------
// The collapsed summary line is always visible while the rows below it are not,
// which makes it the worst place to overstate: it summed every worker — including
// the nine whose figures are context-window estimates once this plugin started
// reading that family — and called the result "provider-reported tokens across all
// workers". On the ten real workers that is 2,490,239, of which 2,012,555 (81%) is
// estimated. A sum cannot tell the difference by itself, so the provenance is a fact
// computed in lib/ and asserted here against real numbers.
const providerRow = { tokenUsage: 477684, tokenUsageSource: "provider" };
const estimateRow = { tokenUsage: 232021, tokenUsageSource: "context-estimate" };

assert.equal(totalUsageProvenance([providerRow]), "provider", "a sum of reported totals is a provider figure");
assert.equal(totalUsageProvenance([estimateRow]), "estimate", "a sum of estimates is an estimate, however it is printed");
assert.equal(
  totalUsageProvenance([providerRow, estimateRow]),
  "mixed",
  "one of each is mixed — the case that must never be labelled provider-reported",
);
assert.equal(
  totalUsageProvenance([{ tokenUsage: 100 }, { tokenUsage: 200 }]),
  "estimate",
  "a figure with NO declared source is not assumed reported: unattributed counts as estimate, the safe direction",
);
assert.equal(
  totalUsageProvenance([{ tokenUsage: 5, tokenUsageSource: "provider", children: [{ tokenUsage: 7 }] }]),
  "mixed",
  "a child's figure is counted too, and is unattributed because the child payload carries no source",
);
assert.equal(totalUsageProvenance([]), null, "an empty history has no provenance");
assert.equal(totalUsageProvenance([{ tokenUsage: null }]), null, "rows with no figure contribute no provenance");
assert.equal(
  totalUsageProvenance([providerRow, { tokenUsage: null }]),
  "provider",
  "an unreported row does not turn a provider sum into a mixed one",
);

// The real fleet, as measured: the case that made this necessary.
const fleet = [
  providerRow,
  ...[232021, 393622, 227838, 101518, 87296, 85930, 364240, 430399, 89691].map((tokenUsage) => ({
    tokenUsage,
    tokenUsageSource: "context-estimate",
  })),
];
assert.equal(
  totalUsageProvenance(fleet),
  "mixed",
  "the ten real workers are a mixed fleet, which is what the summary had been calling provider-reported",
);
assert.equal(totalTokenUsage(fleet), 2490239, "and the total itself is unchanged — only the claim about it was wrong");

// The two event families, as the host sends them. Distinct values are the point:
// a fixture that used the same number in both families let a mutation return the
// estimate while labelling it `provider` and stay green — adversarial review found
// that, and the two numbers below are what make the assertions discriminate.
const CONTEXT_EVENT = (used, window, estimated = true) => ({
  type: "thread/contextWindowUsage/updated",
  data: { contextWindowUsage: { usedTokens: used, modelContextWindow: window, estimated } },
});
const TOKEN_EVENT = (total) => ({
  type: "thread/tokenUsage/updated",
  data: { tokenUsage: { total: { totalTokens: total, inputTokens: 100, outputTokens: 10 } } },
});

// --- 3b. A reading that is NOT an estimate is not stamped as one. ------------
// The `(est.)` badge and the provenance are asserted on a reading the provider
// reported as measured, because the whole previous pin checked for the literal
// `(est.)` string and stayed green when `estimated` was forced to `false` on every
// reading — the badge was pinning its own text, not the fact it announces. Adversarial
// review found that; the mutation is the one below as a test.
const measuredReading = contextUsageFromEvents([CONTEXT_EVENT(64919, 1000000, false)]);
assert.equal(measuredReading.estimated, false, "a provider that says its reading is not an estimate is believed");
assert.equal(
  usageFromEvents([CONTEXT_EVENT(64919, 1000000, false)]).context.estimated,
  false,
  "and the flag survives into the reading the UI labels from, so forcing it false on a true estimate is detectable",
);
assert.equal(
  usageFromEvents([CONTEXT_EVENT(64919, 1000000, true)]).context.estimated,
  true,
  "while an estimated reading stays marked, which is the direction that protects the reader",
);
assert.notEqual(
  usageFromEvents([CONTEXT_EVENT(1, 1000, true)]).context.estimated,
  usageFromEvents([CONTEXT_EVENT(1, 1000, false)]).context.estimated,
  "the two kinds of reading are distinguishable — a hardcoded flag makes every reading alike",
);

// --- The measurement wins, and the fixture proves WHICH number won. ----------
// The original fixture used the SAME value in both families (477684 in each), so a
// mutation returning the context reading while labelling it `provider` stayed green —
// the assertion checked the label and never proved the value. Adversarial review found
// that; two DIFFERENT numbers are what make this discriminate, and the second assertion
// below is the one that goes red on the mutation.
const bothFamilies = usageFromEvents([TOKEN_EVENT(500), CONTEXT_EVENT(64919, 1000000)]);
assert.equal(
  bothFamilies.total,
  500,
  "the provider total is the value used, not the context reading — asserted against a DIFFERENT context number, so the label cannot stand in for the value",
);
assert.equal(bothFamilies.source, "provider", "and it is labelled a provider measurement");
assert.notEqual(
  bothFamilies.total,
  64919,
  "and specifically not the context reading beside it, which is the swap the equal-value fixture let through",
);

// With no provider total, the context reading supplies the figure and says so.
const estimatedOnly = usageFromEvents([CONTEXT_EVENT(64919, 1000000)]);
assert.equal(estimatedOnly.total, 64919, "with no token total, the context reading supplies the figure");
assert.equal(
  estimatedOnly.source,
  "context-estimate",
  "and it is labelled an estimate — printing it as a measurement is the same class of error as printing 0 for unknown",
);
assert.equal(estimatedOnly.context.estimated, true, "the estimate flag survives into the reading");

// Nothing reported is null, not zero, and has no source to claim.
const nothing = usageFromEvents([]);
assert.equal(nothing.total, null, "nothing reported is null, not zero");
assert.equal(nothing.source, null, "and it has no source, so a caller cannot claim one");
assert.equal(nothing.context, null, "and no context either");

// A measured zero is still a measurement.
const realZero = usageFromEvents([TOKEN_EVENT(0)]);
assert.equal(realZero.total, 0, "a measured zero total survives");
assert.equal(realZero.source, "provider", "and keeps its provider label");
assert.notEqual(
  usageFromEvents([TOKEN_EVENT(0), CONTEXT_EVENT(64919, 1000000)]).total,
  64919,
  "a measured zero is not replaced by a context reading — zero is a reading, not an absence",
);

console.log("token usage test ok: provider totals win, context estimates are labelled, absent usage stays hidden");