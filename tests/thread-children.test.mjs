import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_CHILDREN, attachChildTokenUsage, attachChildTokenBreakdown, shapeChildThreads } from "../lib/thread-children.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const workerHistory = readFileSync(join(root, "components", "worker-history", "worker-history.tsx"), "utf8");

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
assert.deepEqual(
  attachChildTokenBreakdown(shaped, { thr_a: { input: 800, output: 200, cached: null, reasoning: null, total: 1000 }, thr_b: null }),
  [
    { threadId: "thr_a", title: "Proposal A", status: "idle", providerId: "acp-opencode", tokenBreakdown: { input: 800, output: 200, cached: null, reasoning: null, total: 1000 } },
    { threadId: "thr_b", title: null, status: "active", providerId: null, tokenBreakdown: null },
  ],
  "breakdowns attach per child, unreadable children stay unknown",
);
assert.deepEqual(attachChildTokenBreakdown(shaped, { thr_a: { input: -5, output: NaN } }), [
  { threadId: "thr_a", title: "Proposal A", status: "idle", providerId: "acp-opencode", tokenBreakdown: null },
  { threadId: "thr_b", title: null, status: "active", providerId: null, tokenBreakdown: null },
], "negative and NaN legs never render as real usage");
assert.deepEqual(attachChildTokenBreakdown(null, {}), [], "non-lists attach to nothing");

// Breakdowns ride the same history entries as totals: one latest event
// per thread, totals kept, split added. The contract pins both fields so
// a dropped split fails loudly instead of rendering half a story.
assert.match(server, /tokenBreakdown: report\.breakdown/, "history entries carry the split beside the total");
assert.match(server, /tokenBreakdown: z\.object\(\{ input: z\.number\(\)\.nullable\(\), output: z\.number\(\)\.nullable\(\), cached: z\.number\(\)\.nullable\(\), reasoning: z\.number\(\)\.nullable\(\), total: z\.number\(\)\.nullable\(\) \}\)\.nullable\(\)/, "worker history schemas carry the split on entries and children");
assert.match(workerHistory, /sumTokenBreakdowns\(history\.flatMap/, "the card total sums splits through the lib");
assert.match(workerHistory, /legs\.join\(" · "\)/, "reported legs render labeled, omitted legs never render");

console.log("thread children test ok: shaping, fallbacks, deleted filter, cap, token attach");
