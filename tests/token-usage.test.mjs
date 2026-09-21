import assert from "node:assert/strict";
import { formatTokenUsage, tokenUsageFromEvents, totalTokenUsage } from "../lib/token-usage.mjs";

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

console.log("token usage test ok: provider totals only, absent usage stays hidden");
