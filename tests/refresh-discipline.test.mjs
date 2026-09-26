import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceBetween } from "./helpers/source-slice.mjs";

// Refresh discipline: every host wrapper that mutates tracking or claims
// must publish card-state (and board-changed) so claimed indicators,
// rework scopes, synced scopes, and transitions flip on the card without
// waiting for the next lifecycle event. Check is the only exemption
// (read-only). Sliced by function markers: topology, not copy.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperFamily = readFileSync(
  join(root, "server/runtime/cli/cli-helper-passthrough.ts"),
  "utf8",
);
const gapScopes = readFileSync(
  join(root, "server/runtime/cli/cli-gap-scopes.ts"),
  "utf8",
);
const lockFamily = readFileSync(join(root, "server/runtime/cli/cli-lock.ts"), "utf8");
const splitFamily = readFileSync(join(root, "server/runtime/cli/cli-split.ts"), "utf8");
const scopeModule = readFileSync(join(root, "server/scopes.ts"), "utf8");

/** The text of one named command family, failing loudly if it is gone. */
function command(text, name) {
  return sourceBetween(text, `function create${name}Command(`, "\n}\n");
}

function assertRefresh(label, body) {
  assert.match(body, /bb\.realtime\.publish\("card-state"/, `${label} refreshes the card`);
  assert.match(body, /bb\.realtime\.publish\("board-changed"/, `${label} refreshes the board`);
}

assertRefresh("sync-scopes", command(helperFamily, "SyncScopes"));
assert.match(helperFamily, /createScopeCommand\(deps\)/, "scope is a family of its own");
assert.match(helperFamily, /argv\[0\] === "scope" \? deps\.scopeCommand\(argv, ctx\) : null/, "scope delegates to the extracted wrapper");
assert.match(scopeModule, /deps\.bb\.realtime\.publish\("card-state"/, "scope refreshes the card");
assert.match(scopeModule, /deps\.bb\.realtime\.publish\("board-changed"/, "scope refreshes the board");
assertRefresh("gap-scopes", gapScopes);

const lock = command(lockFamily, "Lock");
assert.match(
  lock,
  /\(target\.op === "acquire" \|\| target\.op === "release"\) &&\s*result\.code === 0/,
  "only mutating lock ops refresh",
);
assertRefresh("lock", lock);

// Split mutates the board twice over: the parent card and the board list.
assertRefresh("split", splitFamily);
assert.match(splitFamily, /bb\.realtime\.publish\("board-changed", \{ cardId: card\.id \}\)/, "split refreshes the board");

console.log("refresh discipline test ok: mutating wrappers publish, check stays silent");
