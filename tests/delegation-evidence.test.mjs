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

// Server wiring: the tripwire command lists, reads the worker timeline
// (never the provider session), and counts through the prose-proof
// counter. Read-only like verify-tasks: no writes, no publishes, no
// comments — findings guide, nothing enforces.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/cli-registry.ts"), "utf8"),
].join("\n");
assert.match(server, /verify-delegation[\s\S]*Count worker subagent delegations/, "the delegation tripwire is listed");
assert.match(server, /if\s*\(argv\[0\]\s*===\s*"verify-delegation"\)\s*\{/, "the tripwire branch exists");
assert.match(
  server,
  /threads\s*\.timeline\(\{\s*threadId: delegationCard\.worker_thread_id,\s*segmentLimit: "100",?\s*\}\)/,
  "the tripwire reads the worker timeline, never the provider session",
);
assert.match(server, /countDelegations\(timeline\)/, "delegation counting rides the prose-proof lib counter");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(server.slice(server.indexOf('if (argv[0] === "verify-delegation") {'), server.indexOf('if (argv[0] === "draft") {'))), "verify-delegation makes zero database writes");

console.log("delegation evidence test ok: structural counting, prose-proof, honest summaries");
