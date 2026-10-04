import assert from "node:assert/strict";
import {
  NATIVE_PROBE_TTL_MS,
  clearNativeWorkflowCache,
  isNativeProbeFresh,
  nativeProbeCacheKey,
} from "../server/bb-workflow-bridge.ts";

assert.equal(NATIVE_PROBE_TTL_MS, 60_000, "probe cache TTL is one minute");
assert.equal(
  nativeProbeCacheKey({ projectId: "p", threadId: "t", workspaceId: "w" }),
  "p::t::w",
  "cache key names project, thread, and workspace",
);
assert.notEqual(
  nativeProbeCacheKey({ projectId: "p", threadId: "t1", workspaceId: "w" }),
  nativeProbeCacheKey({ projectId: "p", threadId: "t2", workspaceId: "w" }),
  "different threads never share a probe result",
);
const now = Date.now();
assert.equal(isNativeProbeFresh({ at: now, available: true }, now), true, "a fresh probe is reused");
assert.equal(
  isNativeProbeFresh({ at: now - NATIVE_PROBE_TTL_MS, available: true }, now),
  false,
  "an expired probe is re-probed",
);
assert.equal(isNativeProbeFresh(undefined, now), false, "no entry means probe");
assert.equal(
  isNativeProbeFresh({ at: now + 1_000, available: true }, now),
  false,
  "a future timestamp never reads as fresh",
);
assert.doesNotThrow(() => clearNativeWorkflowCache(), "cache clear is safe to call");

console.log("native probe cache test ok: key, TTL, and freshness");
