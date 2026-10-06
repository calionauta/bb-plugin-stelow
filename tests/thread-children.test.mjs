import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_CHILDREN,
  attachChildTokenUsage,
  attachChildTokenBreakdown,
  shapeChildThreads,
} from "../lib/thread-children.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server.ts"), "utf8"),
  readFileSync(join(root, "server", "card-detail-rpc-contract.ts"), "utf8"),
].join("\n");
const sharedSchemas = readFileSync(join(root, "server", "contracts.ts"), "utf8");
const workerBackend = readFileSync(
  join(root, "server", "workers-history.ts"),
  "utf8",
);
const workerHistory = readFileSync(
  join(root, "components", "worker-history", "worker-history.tsx"),
  "utf8",
);

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
// per thread, totals kept, split added. The contract pins both fields so
// a dropped split fails loudly instead of rendering half a story.
assert.match(
  workerBackend,
  /tokenBreakdown: report\.breakdown/,
  "history entries carry the split beside the total",
);
// The schema moved to server/contracts.ts, because it was declared twice in
// the detail contract and a leg added for children and not for the parent
// renders as "no usage" on the run it belongs to. The pin follows the shape:
// it still has to carry every leg, and it has to be the shape BOTH the entry
// and its children use — one name for the one story.
// The schema lives in server/contracts.ts now, and the WHOLE entry object moved with
// it when the detail contract crossed the repository's 400-line budget. The pin reads
// the file that owns the shape, and keeps asserting both legs, so a leg added for
// children and not for the parent still fails here.
assert.match(
  sharedSchemas,
  /tokenBreakdown: tokenBreakdownSchema/,
  "worker history entries and their children share one breakdown schema, not two spellings of it",
);
assert.equal(
  (sharedSchemas.match(/tokenBreakdown: tokenBreakdownSchema/g) ?? []).length,
  2,
  "both legs use it — a child thread that reported a split cannot render as no usage",
);
// And the detail contract must USE the shared entry schema rather than re-spelling it,
// which is the failure the extraction exists to prevent.
assert.match(
  server,
  /workerHistory: z\.array\(workerHistoryEntrySchema\)/,
  "the card detail references the shared entry schema instead of declaring a second one",
);
// One regex per leg would stop being one regex, so this is split at the legs
// instead: five alternatives in a row is the shape being asserted, and a
// 190-character line asserts it illegibly.
const SHARED_BREAKDOWN_LEGS = new RegExp([
  "export const tokenBreakdownSchema = z\\s*\\.object\\(\\{",
  "[\\s\\S]*?input:", "[\\s\\S]*?output:", "[\\s\\S]*?cached:",
  "[\\s\\S]*?reasoning:",
  "[\\s\\S]*?total: z\\s*\\.number\\(\\)\\s*\\.nullable\\(\\),",
  "\\s*\\}\\)\\s*\\.nullable\\(\\)",
].join(""));

assert.match(
  sharedSchemas,
  SHARED_BREAKDOWN_LEGS,
  "the shared schema declares all five legs, nullable per leg so an unreported leg is unknown rather than zero",
);
assert.match(
  workerHistory,
  /sumTokenBreakdowns\(history\.flatMap/,
  "the card total sums splits through the lib",
);
assert.match(
  workerHistory,
  /legs\.join\(" · "\)/,
  "reported legs render labeled, omitted legs never render",
);

console.log(
  "thread children test ok: shaping, fallbacks, deleted filter, cap, token attach",
);
