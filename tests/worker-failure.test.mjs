import assert from "node:assert/strict";
import { truncateCause, summarizeProviderDetail, failureCauseFromEvents } from "../lib/worker-failure.mjs";

// The 400-before-first-output shape: provider detail carries code + JSON.
assert.equal(
  summarizeProviderDetail('400: {"type":"error","message":"Internal server error"}'),
  "Provider error 400: Internal server error",
  "code + JSON message shapes into one line",
);

// Non-JSON detail still surfaces, truncated.
assert.equal(
  summarizeProviderDetail("503: upstream overloaded, try again later"),
  "Provider error 503: upstream overloaded, try again later",
  "plain-text detail keeps the code prefix",
);

// Bare code with nothing after it.
assert.equal(summarizeProviderDetail("400: "), "Provider error 400", "empty rest keeps just the code");

// Whole-JSON detail without a code prefix.
assert.equal(
  summarizeProviderDetail('{"message":"boom"}'),
  "boom",
  "bare JSON unwraps its message",
);

// Nothing worth storing.
assert.equal(summarizeProviderDetail(null), null, "null detail has no cause");
assert.equal(summarizeProviderDetail("   "), null, "blank detail has no cause");
assert.equal(summarizeProviderDetail(42), null, "non-string detail has no cause");

// Long details never leak unbounded into card surfaces.
const long = summarizeProviderDetail(`500: ${"x".repeat(500)}`);
assert.ok(long !== null && long.length <= 180, "cause is capped");

// Newest-first events: the latest provider/error wins.
assert.equal(
  failureCauseFromEvents([
    { type: "provider/error", data: { message: "Provider error", detail: '400: {"type":"error","message":"Internal server error"}', willRetry: true } },
    { type: "provider/error", data: { message: "Provider error", detail: '500: {"type":"error","message":"Older"}', willRetry: true } },
  ]),
  "Provider error 400: Internal server error",
  "latest provider/error detail wins",
);

// Provider events without a usable detail fall through to system/error.
assert.equal(
  failureCauseFromEvents([
    { type: "provider/error", data: { message: "Provider error", detail: "   " } },
    { type: "system/error", data: { message: "host reconnect gave up" } },
  ]),
  "host reconnect gave up",
  "system/error is the fallback cause",
);

// Unknown shapes never throw and never invent a cause.
assert.equal(failureCauseFromEvents(null), null, "non-array has no cause");
assert.equal(failureCauseFromEvents([]), null, "empty events have no cause");
assert.equal(failureCauseFromEvents([{ type: "turn/started", data: {} }]), null, "unrelated events have no cause");
assert.equal(failureCauseFromEvents([{ type: "provider/error", data: null }]), null, "null data has no cause");

console.log("worker failure test ok: provider detail shapes into a card-ready cause");
