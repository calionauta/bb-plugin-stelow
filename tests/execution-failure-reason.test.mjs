import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";

/**
 * A failure must reach the card as the reason the host gave.
 *
 * Found in production on card_k9gei1jy, whose own comment log read:
 *
 *   Native scope-map failed with native status queued.
 *   Native interface-contrast failed with native status running.
 *
 * Two sentences that contradict themselves, both written by the same five
 * lines. The reason is a four-link chain, and the truth dies at link two:
 *
 *   1. the recipe script returns `{ state, error }`, and `scriptOutcome` in
 *      bb-workflow-bridge folds the real message into `scriptError` — including
 *      the silent no-op case, "the recipe produced no task outputs";
 *   2. the reconciler typed the native status as `{ state: string }`, so the
 *      message was thrown away at the type boundary;
 *   3. it wrote the literal `unknown-native-state`, at the exact point where the
 *      state had been matched from a known set — a name that says the STATE is
 *      unknown, which is the one thing it was not;
 *   4. the comment interpolated `run.nativeStatus`, the value BEFORE the
 *      transition, into a sentence about the one AFTER.
 *
 * And then a run-detail disclosure shipped that renders `errorCode` to the user
 * under a "Failed with" label, so the fabrication stopped being a database
 * lie and became a confident one on screen. A fix that makes bad data more
 * visible is a fix that increases the damage until the data is right.
 *
 * This pins the shape of the chain, not the strings: the signature must carry
 * the reason, the code must not name a state it just matched, and the sentence
 * must quote the value it just wrote.
 */
const server = (file) => readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "server", file), "utf8");
const bridge = server("bb-workflow-bridge.ts");

/**
 * Source with comments stripped. The fix explains the string it removed, so the
 * file legitimately still CONTAINS `unknown-native-state` — in prose, saying
 * what used to be there. A test that cannot tell documentation from code is a
 * test people learn to work around, and the workaround is deleting the
 * explanation.
 */
const reconcile = codeOf(server("execution-reconcile-run.ts"));

test("the reason the host produced is the reason the card gets", () => {
  // Link 1: the host really does hand us a reason, so discarding it was a
  // choice and not a limitation of the platform.
  assert.match(
    bridge,
    /scriptError: error/,
    "bb-workflow-bridge must fold the recipe's own error message into the outcome",
  );
  assert.match(
    bridge,
    /scriptError: "the recipe produced no task outputs"/,
    "and the silent no-op case must carry its own reason — that is the failure this whole chain was hiding",
  );
});

test("the signature carries the reason instead of refusing it", () => {
  // Link 2. This is the one that actually broke: `{ state: string }` made
  // `scriptError` a type error, so the honest answer was unreachable.
  assert.match(
    reconcile,
    /type NativeStatus = \{\s*\n\s*state: string;\s*\n\s*scriptError\?: string \| null;/,
    "the reconciler's native status type must accept the reason the bridge already sends",
  );
  assert.doesNotMatch(
    reconcile,
    /native: \{ state: string \}/,
    "the old signature is the bug: it refused the reason that was on the wire",
  );
});

test("a known state is never recorded as an unknown one", () => {
  // Link 3. The name was a lie by construction: this function is only reached
  // when the state matched SIMPLE_STATES.
  assert.doesNotMatch(
    reconcile,
    /unknown-native-state/,
    "'unknown-native-state' is written at the one point where the state is known; a state problem is not what went wrong",
  );
  assert.match(
    reconcile,
    /the host reported a failure without a reason/,
    "when the host genuinely gives no reason, say THAT — a gap about the reason, which is a different and true claim",
  );
});

test("the log quotes the value it just wrote, not the one it replaced", () => {
  // Link 4, the one a reader sees. `run.nativeStatus` is the pre-transition
  // status; interpolating it into "failed with native status ..." is how the
  // card said "failed with native status queued".
  assert.doesNotMatch(
    reconcile,
    /failed with native status \$\{run\.nativeStatus\}/,
    "quoting the pre-transition status produced self-contradicting sentences in the card's own log",
  );
  assert.match(
    reconcile,
    /Native \$\{run\.recipeId\} failed: \$\{next\.errorCode \?\? reason\}/,
    "the sentence must read back the row that was just written",
  );
});
