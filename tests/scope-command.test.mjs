import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScopeArgs } from "../lib/scope-command.mjs";

// The worker has no scripts/stelow binary in a bb workspace, so scope
// transitions need a host wrapper like sync-scopes and lock have. Arg
// parsing is unit-tested behaviorally here (every refusal shape, every
// forward shape); the branch pins below only assert the wrapper exists
// and trails plus refreshes.
assert.deepEqual(parseScopeArgs(["start", "--scope", "scope-1"]), {
  op: "start", scopeId: "scope-1", passthrough: ["start", "--scope", "scope-1"], projectId: null,
}, "minimal start parses");
assert.deepEqual(parseScopeArgs(["seed-tasks", "--scope", "scope-1", "--tasks", "[]"]), {
  op: "seed-tasks", scopeId: "scope-1", passthrough: ["seed-tasks", "--scope", "scope-1", "--tasks", "[]"], projectId: null,
}, "seed-tasks forwards its payload");
assert.deepEqual(
  parseScopeArgs(["done", "--scope", "scope-2", "--project", "p1", "--name", "w", "--iteration", "3", "--actual-files", "a.ts,b.ts", "--json"]),
  {
    op: "done", scopeId: "scope-2",
    passthrough: ["done", "--scope", "scope-2", "--name", "w", "--iteration", "3", "--actual-files", "a.ts,b.ts", "--json"],
    projectId: "p1",
  },
  "every forward flag passes through, project stays host-side",
);
assert.ok(parseScopeArgs(["bogus", "--scope", "scope-1"]).error, "unknown ops refuse");
assert.ok(parseScopeArgs(["start"]).error, "missing scope refuses");
assert.ok(parseScopeArgs(["start", "--scope", "scope-1", "--bogus"]).error, "stray flags refuse");
assert.ok(parseScopeArgs(["start", "--scope", "scope-1", "--name"]).error, "dangling values refuse");
assert.ok(parseScopeArgs(null).error, "junk refuses");
assert.ok(parseScopeArgs(["done", "--scope", "scope-1", "--json", "--json"]).error === undefined, "repeated boolean flags pass");

// Topology pins (wiring only): server delegates the command to the extracted
// module with the dependencies it owns; behavior is covered against the module.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const scopeModule = readFileSync(join(root, "server/scopes.ts"), "utf8");
const start = server.indexOf('if (argv[0] === "scope") {');
assert.ok(start >= 0, "the scope branch exists");
const end = server.indexOf('if (argv[0] === "lock") {', start);
assert.ok(end > start, "the scope branch sits beside the helper wrappers");
const branch = server.slice(start, end);
assert.match(branch, /return runScopeCommand\(argv, ctx, \{/, "the server delegates scope transitions");
assert.match(branch, /runHelper,/, "the delegated command receives the shared helper runner");
assert.match(branch, /recordTrackableEvent:/, "the delegated command receives the durable trail writer");
assert.match(
  scopeModule,
  /export async function runScopeCommand(?:<[^>]+>)?\(/,
  "the extracted module owns the command behavior",
);
assert.match(server, /\{ name: "scope", summary: "Validated scope transitions/, "the command is registered with its usage");

console.log("scope command test ok: parsing, extraction wiring, registration");
