import assert from "node:assert/strict";
import { MAX_CHILDREN, shapeChildThreads } from "../lib/thread-children.mjs";

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

console.log("thread children test ok: shaping, fallbacks, deleted filter, cap");
