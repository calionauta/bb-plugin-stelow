import assert from "node:assert/strict";
import { formatTokenUsage, tokenUsageFromEvents, totalTokenUsage, tokenBreakdownFromEvents, sumTokenBreakdowns } from "../lib/token-usage.mjs";

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

console.log("token usage test ok: provider totals only, absent usage stays hidden");
