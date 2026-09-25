import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIM_TTL_MS } from "../lib/card-claims.mjs";

// Lock-protocol contract: the exact surface the worker, the user, and the
// waiter-resume path all depend on. Upstream (`file-locking.md`) or plugin
// drift must break this build loudly, not users silently.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/cli/cli-lock.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/cli/cli-done-build.ts"), "utf8"),
].join("\n");
const lockFamily = readFileSync(join(root, "server/runtime/cli/cli-lock.ts"), "utf8");
const doneFamily = readFileSync(join(root, "server/runtime/cli/cli-done.ts"), "utf8");
const operations = readFileSync(
  join(root, "server/runtime/card-operations.ts"),
  "utf8",
);
const cardState = readFileSync(
  join(root, "server/runtime/card-state.ts"),
  "utf8",
);

/** The text between two markers, failing loudly if either is gone. */
function slice(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(
    from,
    -1,
    `the lock family no longer contains ${JSON.stringify(start)} — this contract needs updating, not deleting`,
  );
  const to = text.indexOf(end, from);
  assert.notEqual(to, -1, `${start} no longer ends at ${end}`);
  return text.slice(from, to);
}

// TTL: one value everywhere. The helper default is 1800s (file-locking.md);
// the host registry must match it, imported from the lib (no local const).
assert.equal(CLAIM_TTL_MS, 30 * 60 * 1000, "registry TTL is 30 minutes");
assert.match(
  lockFamily,
  /import \{[^}]*CLAIM_TTL_MS[^}]*\} from "\.\.\/\.\.\/\.\.\/lib\/card-claims\.mjs"/,
  "the lock family imports the TTL instead of redefining it",
);
assert.doesNotMatch(lockFamily, /const CLAIM_TTL_MS =/, "no local TTL shadow");

// Blocked worker: machine-readable stderr, no retry loop.
assert.match(lockFamily, /BB-LOCK-BLOCKED file=\$\{entry\.file\} heldBy=.*expiresAt=/, "blocked stderr names file, holder, expiry");
assert.match(lockFamily, /do not retry in a loop/i, "blocked worker is told to park the scope, never spin");

// Blocked user: one paused event per file, naming holder + automatic unlock.
assert.match(lockFamily, /`lock-blocked:\$\{target\.card!\.id\}:\$\{entry\.file\}`/, "paused dedupe key is per card per file");
assert.match(source, /no action needed; the host resumes this card on release/i, "paused copy promises automatic resume");

// Release: waiters resolve as resumed and get an agent-only re-acquire nudge.
const notifyFrom = cardState.indexOf("export function createClaimWaiterNotifier(");
assert.notEqual(notifyFrom, -1, "the waiter notifier lives in the card-state runtime slice");
const notify = cardState.slice(notifyFrom);
assert.match(notify, /\["paused"\], "resumed"/, "waiters resolve paused as resumed");
assert.match(notify, /Re-run \\`bb stelow lock acquire/, "waiters get a re-acquire nudge");
assert.match(notify, /visibility: "agent-only"/, "the nudge never pages the human");

// Registry key: effective checkout, never bare project source. The lock
// family resolves the claim key once, and every registry call runs on it.
const claimRoot = slice(
  lockFamily,
  "async function claimRootFor(",
  "function claimSelection(",
);
assert.match(claimRoot, /resolveClaimKey\(\{/, "claims key off the effective checkout");
assert.match(claimRoot, /checkoutPath: checkout\?\.path \?\? null/, "the claim key takes the resolved checkout path");
assert.match(claimRoot, /sourcePath: rootPath/, "the project source stays the fallback");
const acquireBranch = slice(
  lockFamily,
  "async function applyAcquire(",
  "function trailSteals(",
);
assert.match(acquireBranch, /workspacePath: target\.claimRoot/, "every registry call uses the claim key");
assert.match(
  slice(lockFamily, "export function createLockCommand(", "type LockTargetOrRefusal"),
  /\["lock", target\.op, \.\.\.target\.rest\],\n\s*target\.rootPath,/,
  "helper cwd/state stays on the source",
);

// Terminal release is total: every path funnels through one function.
assert.ok(
  doneFamily.includes("await deps.releaseCardClaims(card.id);"),
  "every done track releases the card's claims",
);
assert.match(operations, /if \(isClaimTerminal\(status\)\) await deps\.releaseClaims\(cardId\)/, "board moves release on every terminal status");

// Ghost holders are terminal-or-gone everywhere, never archived-only:
// a completed/blocked holder must not park a live card behind it. One
// liveness predicate serves the acquire reap, the acquire block, and check.
const liveHolder = slice(
  lockFamily,
  "function isLiveHolder(",
  "function blockedResult(",
);
assert.match(liveHolder, /holder !== undefined && !isClaimTerminal\(holder\.status\);/, "live-holder filter covers every terminal state");
const reap = slice(lockFamily, "function reapDeadHolders(", "function queueWaiters(");
assert.match(
  reap,
  /const dead = outcome\.conflicts\.filter\(\(entry\) => !isLiveHolder\(deps, entry\)\);/,
  "acquire-path ghost reap covers every terminal state",
);
assert.match(acquireBranch, /const live = outcome\.conflicts\.filter\(\(entry\) => isLiveHolder\(deps, entry\)\);/, "acquire blocks on live holders only");
assert.match(
  slice(lockFamily, "async function applyCheck(", "  if (liveWalls.length === 0)"),
  /seen\?\.conflicts \?\? \[\]\)\.filter\(\(entry\) => isLiveHolder\(deps, entry as ClaimConflict\)\)/,
  "check walls on live holders only",
);
assert.match(cardState, /if \(!card \|\| isClaimTerminal\(card\.status\)\) \{/, "waiter resume skips every terminal waiter");

console.log("lock-protocol-contract: ok");
