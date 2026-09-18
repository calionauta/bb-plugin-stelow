import assert from "node:assert/strict";
import { MAX_CHILDREN, attachChildTokenUsage, shapeChildThreads } from "../lib/thread-children.mjs";

// Shaping only: deleted threads hide, fields fall back, the list caps.
assert.deepEqual(shapeChildThreads(null), [], "non-lists shape to nothing");
assert.deepEqual(shapeChildThreads("x"), [], "non-arrays shape to nothing");
assert.deepEqual(
  shapeChildThreads([
    { id: "thr_a", title: "Proposal A", status: "idle", providerId: "acp-opencode" },
    { id: "thr_b", title: null, titleFallback: "Fallback", status: "active", providerId: "codex" },
    { id: "thr_c", status: "error" },
    { id: "thr_gone", title: "Gone", status: "idle", deletedAt: 123 },
    null,
    { noId: true },
  ]),
  [
    { threadId: "thr_a", title: "Proposal A", status: "idle", providerId: "acp-opencode" },
    { threadId: "thr_b", title: "Fallback", status: "active", providerId: "codex" },
    { threadId: "thr_c", title: null, status: "error", providerId: null },
  ],
  "deleted and id-less entries drop, titles fall back, provider passes through",
);

// Cap: a runaway fan-out never floods the card detail payload.
const many = Array.from({ length: MAX_CHILDREN + 5 }, (_, index) => ({ id: `thr_${index}`, status: "idle" }));
assert.equal(shapeChildThreads(many).length, MAX_CHILDREN, "children cap at MAX_CHILDREN");
assert.equal(MAX_CHILDREN, 10, "cap stays small enough for one detail load");

// Token attach: known totals merge by thread id; unknown stays null (never
// zero), garbage maps and non-lists degrade to nulls/empties.
const shaped = [
  { threadId: "thr_a", title: "Proposal A", status: "idle", providerId: "acp-opencode" },
  { threadId: "thr_b", title: null, status: "active", providerId: null },
];
assert.deepEqual(
  attachChildTokenUsage(shaped, { thr_a: 12500, thr_b: null }),
  [
    { threadId: "thr_a", title: "Proposal A", status: "idle", providerId: "acp-opencode", tokenUsage: 12500 },
    { threadId: "thr_b", title: null, status: "active", providerId: null, tokenUsage: null },
  ],
  "known totals attach, unreadable children stay unknown",
);
assert.deepEqual(attachChildTokenUsage(shaped, { thr_a: -3, thr_b: NaN }), [
  { threadId: "thr_a", title: "Proposal A", status: "idle", providerId: "acp-opencode", tokenUsage: null },
  { threadId: "thr_b", title: null, status: "active", providerId: null, tokenUsage: null },
], "negative and NaN totals never render as real costs");
assert.deepEqual(attachChildTokenUsage(shaped, null), shaped.map((child) => ({ ...child, tokenUsage: null })), "a failed usage fetch degrades every child to unknown");
assert.deepEqual(attachChildTokenUsage(null, {}), [], "non-lists attach to nothing");

console.log("thread children test ok: shaping, fallbacks, deleted filter, cap, token attach");
