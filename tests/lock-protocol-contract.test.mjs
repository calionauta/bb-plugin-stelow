import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIM_TTL_MS } from "../lib/card-claims.mjs";

// Lock-protocol contract: the exact surface the worker, the user, and the
// waiter-resume path all depend on. Upstream (`file-locking.md`) or plugin
// drift must break this build loudly, not users silently.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "server/plugin-runtime.ts"), "utf8");
const operations = readFileSync(
  join(root, "server/runtime/card-operations.ts"),
  "utf8",
);
const cardState = readFileSync(
  join(root, "server/runtime/card-state.ts"),
  "utf8",
);

/** The text between two markers, failing loudly if either is gone. */
function slice(start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `server.ts no longer contains ${JSON.stringify(start)} — this contract needs updating, not deleting`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `${start} no longer ends at ${end}`);
  return source.slice(from, to);
}

// TTL: one value everywhere. The helper default is 1800s (file-locking.md);
// the host registry must match it, imported from the lib (no local const).
assert.equal(CLAIM_TTL_MS, 30 * 60 * 1000, "registry TTL is 30 minutes");
assert.match(
  source,
  /import \{[^}]*CLAIM_TTL_MS[^}]*\} from "\.\.\/lib\/card-claims\.mjs"/,
  "server.ts imports the TTL instead of redefining it",
);
assert.doesNotMatch(source, /const CLAIM_TTL_MS =/, "no local TTL shadow");

// Blocked worker: machine-readable stderr, no retry loop.
assert.match(source, /BB-LOCK-BLOCKED file=\$\{entry\.file\} heldBy=.*expiresAt=/, "blocked stderr names file, holder, expiry");
assert.match(source, /do not retry in a loop/i, "blocked worker is told to park the scope, never spin");

// Blocked user: one paused event per file, naming holder + automatic unlock.
assert.match(source, /`lock-blocked:\$\{cliCard\.id\}:\$\{entry\.file\}`/, "paused dedupe key is per card per file");
assert.match(source, /no action needed; the host resumes this card on release/i, "paused copy promises automatic resume");

// Release: waiters resolve as resumed and get an agent-only re-acquire nudge.
const notifyFrom = cardState.indexOf("export function createClaimWaiterNotifier(");
assert.notEqual(notifyFrom, -1, "the waiter notifier lives in the card-state runtime slice");
const notify = cardState.slice(notifyFrom);
assert.match(notify, /\["paused"\], "resumed"/, "waiters resolve paused as resumed");
assert.match(notify, /Re-run \\`bb stelow lock acquire/, "waiters get a re-acquire nudge");
assert.match(notify, /visibility: "agent-only"/, "the nudge never pages the human");

// Registry key: effective checkout, never bare project source.
const lockBranch = slice('if (argv[0] === "lock") {', 'if (argv[0] === "config") {');
assert.match(lockBranch, /resolveClaimKey\(\{ checkoutPath: \(await cardCheckout\(cliCard\)/, "claims key off the effective checkout");
assert.match(lockBranch, /workspacePath: claimRoot/, "every registry call uses the claim key");
assert.match(lockBranch, /runHelper\(\["lock", op, \.\.\.rest\], rootPath/, "helper cwd/state stays on the source");

// Terminal release is total: every path funnels through one function.
for (const site of ["await releaseCardClaimsAndNotify(cardId);"]) {
  assert.ok(source.includes(site), `terminal path releases: ${site}`);
}
assert.match(operations, /if \(isClaimTerminal\(status\)\) await deps\.releaseClaims\(cardId\)/, "board moves release on every terminal status");

// Ghost holders are terminal-or-gone everywhere, never archived-only:
// a completed/blocked holder must not park a live card behind it.
assert.match(source, /return !holder \|\| isClaimTerminal\(holder\.status\);/, "acquire-path ghost reap covers every terminal state");
assert.match(source, /return holder !== undefined && !isClaimTerminal\(holder\.status\);/, "live-holder filters cover every terminal state");
assert.match(cardState, /if \(!card \|\| isClaimTerminal\(card\.status\)\) \{/, "waiter resume skips every terminal waiter");

console.log("lock-protocol-contract: ok");
