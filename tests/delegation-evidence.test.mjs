import assert from "node:assert/strict";
import { countDelegations, summarizeDelegationEvidence } from "../lib/delegation-evidence.mjs";

// The host cannot see subagent freshness — only whether any delegation
// happened at all (timeline items). Structural keys count; prose never
// does, so a worker typing the word "delegation" changes nothing.
assert.equal(countDelegations(null), 0, "null counts zero");
assert.equal(countDelegations(""), 0, "empty counts zero");
assert.equal(
  countDelegations({ items: [{ itemKind: "delegation" }, { itemKind: "toolCall" }] }),
  1,
  "structural delegation items count",
);
assert.equal(
  countDelegations('{"preview": "we discussed delegation patterns today"}'),
  0,
  "prose mentioning delegation never counts",
);
assert.equal(
  countDelegations({ events: [{ type: "item/delegation/completed" }, { type: "item/delegation/progress" }] }),
  2,
  "delegation event types count",
);
assert.equal(countDelegations({ a: { b: [{ kind: "delegation" }] } }), 1, "nesting does not hide markers");
assert.equal(countDelegations(BigInt(1)), 0, "unserializable input fails closed to zero");
assert.deepEqual(summarizeDelegationEvidence({ delegations: 3 }), {
  observed: true,
  summary: "3 delegations observed in the worker thread timeline.",
}, "observed reports the count");
assert.deepEqual(summarizeDelegationEvidence({ delegations: 0 }), {
  observed: false,
  summary: "No delegations observed in the worker thread timeline — this audit may be self-review.",
}, "zero reads as inconclusive, never as certain self-review");
assert.deepEqual(summarizeDelegationEvidence({ delegations: 0, truncated: true }), {
  observed: false,
  summary: "No delegations in the returned timeline segments — older turns were not scanned, so this is inconclusive.",
}, "truncation is disclosed, not hidden");

// Server wiring, driven rather than read: the tripwire is a real command
// family, so this loads it the way the server loads it and calls it. It lists
// itself in the registry, claims exactly its verb, reads the worker timeline
// (never a provider session), counts through the prose-proof lib counter, and
// makes zero database writes — asserted here by a db stub that throws on any
// statement, so reaching storage at all fails the test.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  pathToFileURL(new URL("../tests/register-ts-source.mjs", import.meta.url).pathname),
  import.meta.url,
);
const { createVerifyDelegationCommand } = await import("../server/runtime/cli/cli-verify-delegation.ts");
const { stelowCliCommands } = await import("../server/runtime/cli-registry.ts");

assert.ok(
  stelowCliCommands.some((entry) => entry.name === "verify-delegation"),
  "the delegation tripwire is listed",
);

function tripwire({ timeline = { segments: [] }, threadId = "thr_worker" } = {}) {
  const calls = [];
  const card = { id: "card_1", worker_thread_id: threadId };
  const deps = {
    bb: {
      sdk: {
        threads: {
          timeline: async (input) => {
            calls.push(["timeline", input]);
            return timeline;
          },
        },
      },
    },
    getCardByWorkerThread: (id) => (id === threadId ? card : undefined),
    getCard: (id) => (id === card.id ? card : undefined),
    db: {
      prepare: () => {
        calls.push(["db"]);
        throw new Error("the tripwire must not touch the database");
      },
    },
  };
  return {
    calls,
    invoke: (argv) =>
      createVerifyDelegationCommand(deps)(argv, { threadId, projectId: "proj_1" }),
  };
}

const context = { threadId: "thr_worker", projectId: "proj_1" };
const { calls, invoke } = tripwire();
assert.equal(
  await createVerifyDelegationCommand({})(["done"], context),
  null,
  "the tripwire family claims exactly its verb",
);

const counted = await invoke(["verify-delegation"]);
assert.equal(
  counted.stdout,
  "No delegations observed in the worker thread timeline — this audit may be self-review.",
  "an empty timeline is honest about what was not observed",
);
assert.deepEqual(
  calls.filter(([name]) => name === "timeline").map(([, input]) => input),
  [{ threadId: "thr_worker", segmentLimit: "100" }],
  "the tripwire reads the worker timeline, never the provider session",
);

const prose = tripwire({
  timeline: { preview: "we discussed delegation patterns today" },
});
const proseResult = await prose.invoke(["verify-delegation", "--json"]);
assert.deepEqual(
  JSON.parse(proseResult.stdout),
  { card: "card_1", delegations: 0, observed: false },
  "prose mentioning delegation counts nothing, and zero never reads as certain self-review",
);

const structural = tripwire({
  timeline: { items: [{ itemKind: "delegation" }, { itemKind: "toolCall" }] },
});
const structuralResult = await structural.invoke(["verify-delegation"]);
assert.equal(
  structuralResult.stdout,
  "1 delegation observed in the worker thread timeline.",
  "a structural delegation item is what counts",
);

assert.deepEqual(
  [...calls, ...prose.calls, ...structural.calls].filter(([name]) => name === "db"),
  [],
  "verify-delegation makes zero database writes",
);

console.log("delegation evidence test ok: structural counting, prose-proof, honest summaries");
