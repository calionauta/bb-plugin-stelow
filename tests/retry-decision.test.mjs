import assert from "node:assert/strict";
import { RETRY_REFUSALS, refusalNeedsAttention, refusalRecord, retryDecision } from "../lib/retry-decision.mjs";

/**
 * Every way the host declines to retry a failed run, and the record each refusal
 * leaves.
 *
 * The regression this exists to catch was live and measured. Five runs in the live
 * database failed with "the recipe produced no task outputs" and the host retried
 * NONE of them, because `attemptAutoRetry` refused each one with a bare
 * `return idle`: every one of those five reached it with the card already advanced
 * past the failed stage (`scope` -> `audit`), so the stage guard fired and recorded
 * nothing. From the outside that is indistinguishable from "no retry was ever
 * applicable" — the same phantom wait the project's rules forbid, and the reason
 * `auto_retry_count` was 0 on all 54 rows.
 *
 * So the rule lives in one pure function and this file pins all of it: which cases
 * retry, which refuse, that every refusal names an EXIT, and that only a refusal
 * leaving a person a decision is allowed to page them.
 */

const EMPTY_OUTPUT = "the recipe produced no task outputs";
const card = { cardStage: "scope", runStage: "scope", cardExists: true, cardArchived: false };
const decide = (over) => retryDecision({ errorCode: EMPTY_OUTPUT, autoRetryCount: 0, ...card, ...over });
const refuseRecordOrNull = (over) => {
  const d = decide(over);
  return refusalRecord({ reason: d.reason, exit: d.exit, recipeId: "scope-recipe", runId: "run_1", recordable: d.recordable });
};

// --- 1. The one case that retries. ------------------------------------------
const go = decide({});
assert.equal(go.retry, true, "a proved no-op on the same stage retries");
assert.equal(go.reason, null, "and carries no refusal");
assert.equal(go.exit, null, "and needs no exit, because it is not refusing");

// --- 2. The case that silently refused five real runs. ---------------------
const movedOn = decide({ cardStage: "audit" });
assert.equal(movedOn.retry, false, "a card that advanced past the failed stage is not retried");
assert.match(movedOn.reason, /^card-moved-on/, "and the refusal says so by name, instead of returning silently");
assert.ok(movedOn.exit, "and names an exit — a refusal that names no exit is a deadlock with a good error message");
assert.match(movedOn.exit, /audit/, "and the exit names the stage that now stands, so a reader knows why nothing happened");
assert.equal(
  refusalNeedsAttention(movedOn.reason),
  false,
  "and it does NOT page anyone: the card moved on and the situation resolved itself, so an inbox event would be noise",
);

// --- 3. Every refusal names an exit, without exception. ---------------------
// The invariant, asserted over the whole vocabulary rather than case by case, so a
// refusal added later cannot ship without one.
const cases = [
  { label: "nothing proved", over: { errorCode: "some recipe failure" } },
  { label: "card gone", over: { cardExists: false } },
  { label: "card archived", over: { cardArchived: true } },
  { label: "card moved on", over: { cardStage: "audit" } },
  { label: "budget spent", over: { autoRetryCount: 1 } },
];
for (const { label, over } of cases) {
  const d = decide(over);
  assert.equal(d.retry, false, `${label}: refused`);
  assert.ok(typeof d.reason === "string" && d.reason.length > 0, `${label}: the refusal has a name`);
  assert.ok(
    typeof d.exit === "string" && d.exit.length > 0,
    `${label}: the refusal names an exit. A refusal with no exit is the deadlock this file exists to prevent — got ${JSON.stringify(d)}`,
  );
}

// --- 3b. A refusal is recorded only where it says something new. ------------
// `recordable` is the field that keeps the trail honest in both directions: a
// refusal on the no-op path is recorded (that is the fix), and a failure that RAN
// is not, because the caller already wrote a failure line naming the reason and
// saying the card remains available for retry. Two lines about one fact is the
// duplication this project keeps paying for.
assert.equal(decide({}).recordable, false, "a retry in progress records no refusal");
assert.equal(decide({ cardStage: "audit" }).recordable, true, "the stage guard's refusal is recorded — it is the one that failed silently five times");
assert.equal(decide({ autoRetryCount: 1 }).recordable, true, "a spent budget refusal is recorded");
assert.equal(decide({ cardArchived: true }).recordable, true, "an archived card's refusal is recorded: terminality is a fact worth stating");
assert.equal(
  decide({ errorCode: "the recipe script reported a failure" }).recordable,
  false,
  "a failure that RAN is not recorded here — the caller already wrote that fact, and repeating it would be a second line about one thing",
);
assert.equal(
  refuseRecordOrNull({ errorCode: "the recipe script reported a failure" }),
  null,
  "and the record helper honours it, so the caller needs no second check",
);

// --- 4. The reasons are a closed vocabulary. --------------------------------
// Reported reasons must come from the declared list, or a reader cannot enumerate
// what can happen to a card.
for (const { label, over } of cases) {
  const d = decide(over);
  const known = RETRY_REFUSALS.some((r) => d.reason.startsWith(r.split(":")[0]));
  assert.ok(known, `${label}: the reason "${d.reason}" is in the declared vocabulary`);
}
for (const { label, over } of cases) {
  const d = decide(over);
  const record = refusalRecord({ reason: d.reason, exit: d.exit, recipeId: "scope-recipe", runId: "run_1" });
  assert.ok(record.includes("did NOT retry"), `${label}: the record says the retry did not happen`);
  assert.ok(record.includes(d.reason.split(":")[0]), `${label}: and names the reason`);
  assert.ok(record.includes(d.exit.slice(0, 24)), `${label}: and names the exit`);
  assert.ok(record.includes("run_1"), `${label}: and points at the run it is about`);
}

// --- 5. Only a decision paging case pages. ----------------------------------
// The two directions separately: a machine-noise refusal must not page, and a
// refusal that leaves a person a decision must not stay silent.
assert.equal(refusalNeedsAttention("card-moved-on: the card advanced"), false, "a self-resolving refusal never pages");
assert.equal(refusalNeedsAttention("card-gone"), false, "a card that no longer exists never pages");
assert.equal(refusalNeedsAttention("card-archived"), false, "an archived card is terminal and never pages");
assert.equal(
  refusalNeedsAttention("retry-budget-spent: one automatic attempt per chain is the limit"),
  true,
  "a spent budget leaves a person a decision, so it pages",
);
assert.equal(
  refusalNeedsAttention("not-retryable: nothing was proved to have been skipped"),
  true,
  "an unproved failure leaves a person a decision, so it pages",
);
assert.equal(refusalNeedsAttention(null), false, "proceeding is not a refusal and never pages");

// --- 6. The record exists only when there is something to record. -----------
assert.equal(refusalRecord({ reason: null, exit: null, recipeId: "r", runId: "run_1" }), null, "a retry in progress leaves no refusal record");

// --- 7. Absent and malformed inputs refuse rather than throw. ---------------
// This runs inside a reconciliation pass; a throw here would fail the pass, which
// the module's own contract forbids ("stay parked, never fail the pass").
assert.equal(decide({ errorCode: null }).retry, false, "a run with no error code is not retried");
assert.equal(decide({ errorCode: "" }).retry, false, "an empty error code is not retried");
assert.equal(decide({ errorCode: `${EMPTY_OUTPUT} ` }).retry, true, "trailing whitespace on the known error still matches");
assert.equal(decide({ autoRetryCount: undefined }).retry, true, "an absent retry count reads as zero attempts, not as spent");
assert.equal(decide({ autoRetryCount: 0.5 }).retry, true, "a non-integer count is treated as unused rather than as one attempt");
assert.equal(decide({ cardStage: undefined }).retry, false, "an unknown card stage cannot be proved equal to the run's stage");

console.log(
  `retry decision ok: ${cases.length} refusal paths, each naming a reason and an exit · ` +
    `${cases.filter((c) => refusalNeedsAttention(decide(c.over).reason)).length} of them page a person`,
);
