import assert from "node:assert/strict";
import {
  contextUsageFromEvents,
  formatTokenUsage,
  sumTokenBreakdowns,
  tokenBreakdownFromEvents,
  tokenUsageFromEvents,
  totalTokenUsage,
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

console.log("token usage test ok: provider totals win, context estimates are labelled, absent usage stays hidden");

// --- The context-window family, and why it is a DIFFERENT measurement. -------
// Measured on the live database: 837 threads emit thread/contextWindowUsage/updated
// against 148 that emit thread/tokenUsage/updated, and all ten of this plugin's
// worker threads emit a context reading while exactly ONE emits a token total. The
// plugin asked for only the token family, so it reported nothing for eight of ten
// workers — the arithmetic lie F4 exists to remove. The providers that send only a
// context reading are the ACP ones, which is most of them in practice.

const CONTEXT_EVENT = (used, window, estimated = true) => ({
  type: "thread/contextWindowUsage/updated",
  data: { contextWindowUsage: { usedTokens: used, modelContextWindow: window, estimated } },
});
const TOKEN_EVENT = (total) => ({
  type: "thread/tokenUsage/updated",
  data: { tokenUsage: { total: { totalTokens: total, inputTokens: 100, outputTokens: 10 } } },
});

// The context reader reports what the provider sent, including that it is an estimate.
assert.deepEqual(
  contextUsageFromEvents([CONTEXT_EVENT(64919, 1000000)]),
  { usedTokens: 64919, modelContextWindow: 1000000, estimated: true },
  "a context reading carries its window and its estimated flag, so no surface can present it as a measurement",
);
assert.equal(contextUsageFromEvents([TOKEN_EVENT(500)]), null, "a token event is not a context reading — the two families never masquerade as each other");
assert.equal(contextUsageFromEvents([]), null, "no events is null, never zero");
assert.equal(contextUsageFromEvents([CONTEXT_EVENT(-1, 1000)]), null, "a negative reading is refused rather than shown");
assert.equal(
  contextUsageFromEvents([CONTEXT_EVENT(5, 0)])?.modelContextWindow,
  null,
  "an unusable window is null while the used count survives — one bad field does not discard the reading",
);
assert.equal(
  contextUsageFromEvents([CONTEXT_EVENT(5, 100, false)])?.estimated,
  false,
  "a provider that reports a non-estimated reading is believed: the flag is carried, not assumed",
);

// --- usageFromEvents: the measurement wins, the estimate is labelled. --------
const measured = usageFromEvents([TOKEN_EVENT(477684), CONTEXT_EVENT(477684, 1000000)]);
assert.equal(measured.total, 477684, "a provider token total is used as-is");
assert.equal(measured.source, "provider", "and it is labelled a provider measurement");

const estimatedOnly = usageFromEvents([CONTEXT_EVENT(477684, 1000000)]);
assert.equal(estimatedOnly.total, 477684, "with no token total, the context reading supplies the figure");
assert.equal(
  estimatedOnly.source,
  "context-estimate",
  "and it is labelled an estimate — printing it as a measurement is the same class of error as printing 0 for unknown",
);
assert.equal(estimatedOnly.context.estimated, true, "the estimate flag survives into the reading");

const nothing = usageFromEvents([]);
assert.equal(nothing.total, null, "nothing reported is null, not zero");
assert.equal(nothing.source, null, "and it has no source, so a caller cannot claim one");
assert.equal(nothing.context, null, "and no context either");

// A zero the provider really measured is still a zero, and still a measurement.
const realZero = usageFromEvents([TOKEN_EVENT(0)]);
assert.equal(realZero.total, 0, "a measured zero total survives");
assert.equal(realZero.source, "provider", "and keeps its provider label");
