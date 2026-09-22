import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Refresh discipline: every host wrapper that mutates tracking or claims
// must publish card-state (and board-changed) so claimed indicators,
// rework scopes, synced scopes, and transitions flip on the card without
// waiting for the next lifecycle event. Check is the only exemption
// (read-only). Sliced by argv markers: topology, not copy.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");

function branch(open, close) {
  const start = server.indexOf(open);
  assert.ok(start >= 0, `branch exists: ${open}`);
  const end = server.indexOf(close, start);
  assert.ok(end > start, `branch closes: ${open}`);
  return server.slice(start, end);
}

function assertRefresh(name, open, close) {
  const body = branch(open, close);
  assert.match(body, /bb\.realtime\.publish\("card-state"/, `${name} refreshes the card`);
  assert.match(body, /bb\.realtime\.publish\("board-changed"/, `${name} refreshes the board`);
}

assertRefresh("sync-scopes", 'if (argv[0] === "sync-scopes") {', 'if (argv[0] === "scope") {');
assertRefresh("scope", 'if (argv[0] === "scope") {', 'if (argv[0] === "lock") {');
assertRefresh("gap-scopes", 'if (argv[0] === "gap-scopes") {', 'if (argv[0] === "metrics") {');

const lock = branch('if (argv[0] === "lock") {', 'if (argv[0] === "config") {');
assert.match(lock, /\(op === "acquire" \|\| op === "release"\) && result\.code === 0/, "only mutating lock ops refresh");
assert.match(lock, /bb\.realtime\.publish\("card-state"/, "lock refreshes the card");
assert.match(lock, /bb\.realtime\.publish\("board-changed"/, "lock refreshes the board");

console.log("refresh discipline test ok: mutating wrappers publish, check stays silent");
