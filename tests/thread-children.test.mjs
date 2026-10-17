import assert from "node:assert/strict";
import {
  MAX_CHILDREN,
  attachChildTokenUsage,
  attachChildTokenBreakdown,
  shapeChildThreads,
} from "../lib/thread-children.mjs";
import * as tokenUsage from "../lib/token-usage.mjs";
import { tokenBreakdownSchema, workerHistoryEntrySchema } from "../server/contracts.ts";
import { cardDetailRpcContract } from "../server/card-detail-rpc-contract.ts";
import { createWorkerHistory } from "../server/workers-history.ts";
import { loadComponent, renderTree, treeText } from "./helpers/render-component.mjs";

// Shaping only: deleted threads hide, fields fall back, the list caps.
assert.deepEqual(shapeChildThreads(null), [], "non-lists shape to nothing");
assert.deepEqual(shapeChildThreads("x"), [], "non-arrays shape to nothing");
assert.deepEqual(
  shapeChildThreads([
    {
      id: "thr_a",
      title: "Proposal A",
      status: "idle",
      providerId: "acp-opencode",
    },
    {
      id: "thr_b",
      title: null,
      titleFallback: "Fallback",
      status: "active",
      providerId: "codex",
    },
    { id: "thr_c", status: "error" },
    { id: "thr_gone", title: "Gone", status: "idle", deletedAt: 123 },
    null,
    { noId: true },
  ]),
  [
    {
      threadId: "thr_a",
      title: "Proposal A",
      status: "idle",
      providerId: "acp-opencode",
    },
    {
      threadId: "thr_b",
      title: "Fallback",
      status: "active",
      providerId: "codex",
    },
    { threadId: "thr_c", title: null, status: "error", providerId: null },
  ],
  "deleted and id-less entries drop, titles fall back, provider passes through",
);

// Cap: a runaway fan-out never floods the card detail payload.
const many = Array.from({ length: MAX_CHILDREN + 5 }, (_, index) => ({
  id: `thr_${index}`,
  status: "idle",
}));
assert.equal(
  shapeChildThreads(many).length,
  MAX_CHILDREN,
  "children cap at MAX_CHILDREN",
);
assert.equal(MAX_CHILDREN, 10, "cap stays small enough for one detail load");

// Token attach: known totals merge by thread id; unknown stays null (never
// zero), garbage maps and non-lists degrade to nulls/empties.
const shaped = [
  {
    threadId: "thr_a",
    title: "Proposal A",
    status: "idle",
    providerId: "acp-opencode",
  },
  { threadId: "thr_b", title: null, status: "active", providerId: null },
];
assert.deepEqual(
  attachChildTokenUsage(shaped, { thr_a: 12500, thr_b: null }),
  [
    {
      threadId: "thr_a",
      title: "Proposal A",
      status: "idle",
      providerId: "acp-opencode",
      tokenUsage: 12500,
    },
    {
      threadId: "thr_b",
      title: null,
      status: "active",
      providerId: null,
      tokenUsage: null,
    },
  ],
  "known totals attach, unreadable children stay unknown",
);
assert.deepEqual(
  attachChildTokenUsage(shaped, { thr_a: -3, thr_b: NaN }),
  [
    {
      threadId: "thr_a",
      title: "Proposal A",
      status: "idle",
      providerId: "acp-opencode",
      tokenUsage: null,
    },
    {
      threadId: "thr_b",
      title: null,
      status: "active",
      providerId: null,
      tokenUsage: null,
    },
  ],
  "negative and NaN totals never render as real costs",
);
assert.deepEqual(
  attachChildTokenUsage(shaped, null),
  shaped.map((child) => ({ ...child, tokenUsage: null })),
  "a failed usage fetch degrades every child to unknown",
);
assert.deepEqual(
  attachChildTokenUsage(null, {}),
  [],
  "non-lists attach to nothing",
);
assert.deepEqual(
  attachChildTokenBreakdown(shaped, {
    thr_a: {
      input: 800,
      output: 200,
      cached: null,
      reasoning: null,
      total: 1000,
    },
    thr_b: null,
  }),
  [
    {
      threadId: "thr_a",
      title: "Proposal A",
      status: "idle",
      providerId: "acp-opencode",
      tokenBreakdown: {
        input: 800,
        output: 200,
        cached: null,
        reasoning: null,
        total: 1000,
      },
    },
    {
      threadId: "thr_b",
      title: null,
      status: "active",
      providerId: null,
      tokenBreakdown: null,
    },
  ],
  "breakdowns attach per child, unreadable children stay unknown",
);
assert.deepEqual(
  attachChildTokenBreakdown(shaped, { thr_a: { input: -5, output: NaN } }),
  [
    {
      threadId: "thr_a",
      title: "Proposal A",
      status: "idle",
      providerId: "acp-opencode",
      tokenBreakdown: null,
    },
    {
      threadId: "thr_b",
      title: null,
      status: "active",
      providerId: null,
      tokenBreakdown: null,
    },
  ],
  "negative and NaN legs never render as real usage",
);
assert.deepEqual(
  attachChildTokenBreakdown(null, {}),
  [],
  "non-lists attach to nothing",
);

// Breakdowns ride the same history entries as totals: one latest event
// per thread, totals kept, split added. Driven, not read: the entry the
// host builds must carry the split beside the total, so a dropped split
// fails here instead of rendering half a story.
{
  const db = {
    prepare() {
      return {
        all: () => [{
          thread_id: "thr_a",
          preset_id: null,
          preset_name: null,
          started_at: 1,
          ended_at: 2,
          ended_reason: null,
        }],
      };
    },
  };
  const bb = {
    sdk: {
      threads: {
        events: {
          list: async ({ types }) => (types.includes("thread/tokenUsage/updated")
            ? [{
              type: "thread/tokenUsage/updated",
              data: {
                tokenUsage: {
                  total: {
                    inputTokens: 800,
                    outputTokens: 300,
                    cachedInputTokens: 100,
                    cacheReadInputTokens: 50,
                    reasoningOutputTokens: 20,
                    totalTokens: 1270,
                  },
                },
              },
            }]
            : []),
        },
        list: async () => [],
      },
    },
  };
  const entries = await createWorkerHistory(db, bb).history("card_1");
  assert.deepEqual(
    entries[0].tokenBreakdown,
    { input: 800, output: 300, cached: 150, reasoning: 20, total: 1270 },
    "history entries carry the provider split beside the total, cached summing both cache fields",
  );
}

// The schema is shared: the entry and each child carry the same nullable
// five legs, declared once. Asked of the imported schemas, so a second
// spelling, a dropped leg, or a re-declared entry fails here.
assert.equal(
  tokenBreakdownSchema.safeParse({ input: 1, output: 2, cached: 3, reasoning: 4, total: 5 }).success,
  true,
  "the shared breakdown schema declares all five legs",
);
assert.equal(
  tokenBreakdownSchema.safeParse({ input: null, output: null, cached: null, reasoning: null, total: null }).success,
  true,
  "every leg is nullable, so an unreported leg is unknown rather than zero",
);
assert.equal(
  tokenBreakdownSchema.safeParse({ input: 1, output: 2, cached: 3, reasoning: 4 }).success,
  false,
  "a missing leg is refused, so the shape cannot silently drop one",
);
assert.equal(
  workerHistoryEntrySchema.shape.tokenBreakdown,
  tokenBreakdownSchema,
  "the worker history entry uses the shared breakdown schema, not a second spelling",
);
assert.equal(
  workerHistoryEntrySchema.shape.children.element.shape.tokenBreakdown,
  tokenBreakdownSchema,
  "and so does every child thread — one schema for the one story",
);
assert.equal(
  cardDetailRpcContract.cardDetail.output.shape.workerHistory.element,
  workerHistoryEntrySchema,
  "the card detail references the shared entry schema instead of declaring a second one",
);

// The card total sums splits through the lib and renders only the legs
// that were reported, labeled. Rendered, not read: the text a reader sees
// is what is asserted.
{
  const WorkerHistoryList = loadComponent(
    "components/worker-history/worker-history.tsx",
    "WorkerHistoryList",
    {
      "@get-bb/plugin-sdk/app": { useBbNavigate: () => ({ toThread: () => {} }) },
      "@/components/ui/button": { Button: ({ children }) => ({ type: "button", props: {}, children }) },
      "../../lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
      "../disclosure": { DisclosureChevron: () => null, SECTION_SURFACE: "section", SUMMARY_ROW: "summary" },
      "../dashboard/build-status-pills": { Pill: ({ children }) => ({ type: "span", props: {}, children }) },
      "../../lib/worker-action-policy.mjs": { workerSectionPolicy: () => ({}) },
      "../../lib/relative-time.mjs": { relativeTime: () => "just now" },
      "../../lib/token-usage.mjs": tokenUsage,
    },
  );
  const rendered = treeText(renderTree(WorkerHistoryList({
    history: [{
      threadId: "thr_a",
      presetName: null,
      startedAt: 1,
      endedAt: 2,
      endedReason: null,
      tokenUsage: 1000,
      tokenUsageSource: "provider",
      tokenBreakdown: { input: 800, output: 200, cached: null, reasoning: null, total: 1000 },
      children: [],
    }],
  })));
  assert.match(
    rendered,
    /in 800 · out 200/,
    "reported legs render labeled and joined, summed through the lib",
  );
  assert.doesNotMatch(rendered, /cached/, "an omitted leg never renders");
}

console.log(
  "thread children test ok: shaping, fallbacks, deleted filter, cap, token attach",
);
