import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contractRelPath,
  parseEvidenceContract,
  sanitizeEvidenceRecord,
  evidenceConditions,
  enrichEntriesForDetail,
} from "../lib/trackable-evidence.mjs";
import { buildRegistry } from "../lib/trackable-relations.mjs";

// Sidecar paths resolve per kind from the contracts table — one resolver
// for every kind, never a per-kind function. Kinds without a sidecar
// resolve null and stay silent instead of warning on every row.
assert.equal(contractRelPath(".stelow/2026-01-01/abc", "scope", "scope-1"), ".stelow/2026-01-01/abc/scopes/scope-1.json", "scopes resolve their contracts");
assert.equal(contractRelPath(".stelow/2026-01-01/abc", "task", "scope-1-t1"), null, "kinds without sidecars resolve null");
assert.equal(contractRelPath(".stelow/2026-01-01/abc", "bogus", "scope-1"), null, "unknown kinds resolve null");
assert.equal(contractRelPath(".stelow/2026-01-01/abc", "scope", "../../evil"), null, "traversal refuses");
assert.equal(contractRelPath(null, "scope", "scope-1"), null, "missing dirs refuse");

// Contracts are the machine home of acceptance criteria: snake_case from
// the writer, sanitized here. Anything misshapen reads as absent evidence.
assert.deepEqual(parseEvidenceContract(JSON.stringify({
  acceptance_criteria: ["Root renders alone", "  "],
  verify_commands: ["npm test"],
  target_files: ["components/ui/overlay.tsx"],
})), {
  acceptanceCriteria: ["Root renders alone"],
  verifyCommands: ["npm test"],
  targetFiles: ["components/ui/overlay.tsx"],
}, "contract fields parse and trim");
assert.equal(parseEvidenceContract(JSON.stringify({ foo: 1 })), null, "empty contract reads absent");
assert.equal(parseEvidenceContract("{nope"), null, "broken JSON reads absent");
assert.equal(parseEvidenceContract(null), null, "junk reads absent");

// Records travel sanitized: verified plus counts and timestamps, nothing else.
assert.deepEqual(sanitizeEvidenceRecord({
  verified: true, files_count: 3, commands_count: 2, completed_at: "t",
  started_at: "s", suggested_commit: "feat: x", baseline: {},
}), {
  verified: true, filesCount: 3, commandsCount: 2, completedAt: "t", startedAt: "s", suggestedCommit: "feat: x",
}, "record mirror sanitizes to host shape");
assert.equal(sanitizeEvidenceRecord({}), null, "empty record reads absent");
assert.equal(sanitizeEvidenceRecord(null), null, "junk reads absent");

const done = { id: "scope-1", kind: "scope", name: "Overlay", status: "done" };
const verified = { ...done, record: { verified: true }, contract: { acceptanceCriteria: ["a"], verifyCommands: [], targetFiles: [] } };
assert.deepEqual(evidenceConditions({ entry: verified, registry: buildRegistry([verified]) }), [], "verified close carries no conditions");
assert.deepEqual(
  evidenceConditions({ entry: { ...done, record: { verified: false } }, registry: buildRegistry([done]) }).map((condition) => condition.type),
  ["UnverifiedClose", "ContractMissing"],
  "unverified record blocks and missing contract advises",
);
assert.deepEqual(
  evidenceConditions({ entry: done, registry: buildRegistry([done]) }).map((condition) => condition.type),
  ["NoRecord", "ContractMissing"],
  "recordless close advises twice, never blocks",
);
assert.deepEqual(
  evidenceConditions({ entry: { ...done, status: "pending", record: { verified: false } }, registry: buildRegistry([done]) }),
  [],
  "pending entries carry no close-out conditions",
);
assert.deepEqual(evidenceConditions({ entry: null }), [], "junk carries nothing");

// Ordering and honesty conditions on open entries: waiting names its
// blockers, dangling names unknown refs, self-reported progress without
// observable footing warns. Satisfied relations stay silent.
const chain = [
  { id: "scope-1", kind: "scope", status: "done" },
  { id: "scope-2", kind: "scope", status: "pending", blockedBy: ["scope-1"] },
  { id: "scope-3", kind: "scope", status: "pending", blockedBy: ["scope-2", "scope-9"] },
];
const chainRegistry = buildRegistry(chain);
assert.deepEqual(evidenceConditions({ entry: chain[1], registry: chainRegistry }), [], "satisfied relations stay silent");
assert.deepEqual(
  evidenceConditions({ entry: chain[2], registry: chainRegistry }).map((condition) => condition.type),
  ["BlockedByOpen", "DanglingDependency"],
  "open blockers order first, unknown refs advise",
);
assert.deepEqual(
  evidenceConditions({ entry: { id: "scope-4", kind: "scope", name: "Work", status: "in-progress" }, registry: chainRegistry, claimed: false }).map((condition) => condition.type),
  ["UnclaimedExecution"],
  "unclaimed progress warns",
);
assert.deepEqual(
  evidenceConditions({ entry: { id: "scope-4", kind: "scope", name: "Work", status: "in-progress" }, registry: chainRegistry, claimed: false, claimLapsed: true }).map((condition) => condition.type),
  ["ClaimLapsed"],
  "lapsed leases name the stall instead",
);
assert.deepEqual(
  evidenceConditions({ entry: { id: "scope-4", kind: "scope", status: "in-progress", startedAt: "2026-01-01T00:00:00.000Z" }, registry: chainRegistry, claimed: false }),
  [],
  "a recorded start quiets the warning",
);
assert.deepEqual(
  evidenceConditions({ entry: { ...done, tasks: [{ id: "t1", name: "Left", status: "pending" }] }, registry: buildRegistry([{ ...done, tasks: [{ id: "t1", name: "Left", status: "pending" }] }]) }).map((condition) => condition.type),
  ["NoRecord", "ContractMissing", "OpenChildrenOnClose"],
  "done entries with open children name containment",
);
// Kinds without sidecars never warn for lacking one: a done task with no
// record advises once (NoRecord), not twice.
assert.deepEqual(
  evidenceConditions({ entry: { id: "t1", kind: "task", name: "T", status: "done" }, registry: buildRegistry([]) }).map((condition) => condition.type),
  ["NoRecord"],
  "task close advises without a spurious contract warning",
);

// Composition is behaviorally tested with fakes (no SDK, no DB): contracts
// attach, claims resolve, tasks inherit the same machine, and missing
// state dirs resolve bare instead of throwing.
const fakeEntries = [
  { id: "scope-1", kind: "scope", name: "A", status: "in-progress", targetFiles: ["src/a.ts"], tasks: [{ id: "t1", name: "T", status: "pending" }] },
  { id: "scope-2", kind: "scope", name: "B", status: "done", record: { verified: true }, tasks: [] },
];
const fakeContracts = {
  ".stelow/d/abc/scopes/scope-1.json": JSON.stringify({ acceptance_criteria: ["AC1"], verify_commands: [], target_files: [] }),
};
const enriched = await enrichEntriesForDetail({
  entries: fakeEntries,
  stateRelDir: ".stelow/d/abc",
  ownerId: "card1",
  liveClaims: [{ card_id: "card1", scope: null, file_path: "src/a.ts", expires_at: 9_999_999_999_999 }],
  isLapsed: () => false,
  readContract: async (rel) => fakeContracts[rel] ?? null,
  nowMs: 1_000,
});
assert.deepEqual(enriched[0].contract.acceptanceCriteria, ["AC1"], "contracts attach from the uniform layout");
assert.equal(enriched[0].claimed, true, "live claims resolve");
assert.deepEqual(enriched[0].conditions, [], "claimed in-progress carries nothing");
assert.deepEqual(enriched[0].tasks[0].conditions, [], "pending tasks carry nothing");
assert.deepEqual(enriched[1].conditions.map((condition) => condition.type), ["ContractMissing"], "done scope without contract advises");
const bare = await enrichEntriesForDetail({ entries: fakeEntries, stateRelDir: null, ownerId: "card1" });
assert.deepEqual(bare[0].conditions, [], "missing state dir resolves bare");
assert.equal(bare[0].claimed, null, "missing state dir claims unknown");
assert.equal(bare[0].contract, undefined, "missing state dir attaches nothing");
const lapsed = await enrichEntriesForDetail({
  entries: [fakeEntries[0]],
  stateRelDir: ".stelow/d/abc",
  ownerId: "card1",
  liveClaims: [],
  isLapsed: () => true,
  readContract: async () => null,
  nowMs: 1_000,
});
assert.deepEqual(lapsed[0].conditions.map((condition) => condition.type), ["ClaimLapsed"], "lapsed leases name the stall");
assert.deepEqual(await enrichEntriesForDetail({ entries: null }), [], "junk resolves empty");
// Wiring pins: the detail composes enrichment through one function (lib
// owns the topology); the handler only injects SDK and DB.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
assert.match(server, /enrichEntriesForDetail\(/, "card detail enriches through one composition");
assert.match(server, /liveClaimsForWorkspace\(/, "claims derive read-only, never touching TTL");
const gates = readFileSync(join(root, "lib", "build-gates.mjs"), "utf8");
assert.match(gates, /unverified Record — complete every verification checklist/, "done refuses unverified Records with the checklist redirect");
assert.match(server, /recordTrackableEvent\(/, "decisions trail into the event log");
const app = readFileSync(join(root, "app.tsx"), "utf8");
assert.match(app, /scope\.conditions/, "scopes render their conditions");
assert.match(app, /task\.conditions/, "tasks render their conditions through the same machine");
assert.match(app, /Acceptance criteria \(\{scope\.contract\.acceptanceCriteria\.length\}\)/, "scopes surface contract criteria with counts");

console.log("trackable evidence test ok: contracts, records, conditions, wiring");
