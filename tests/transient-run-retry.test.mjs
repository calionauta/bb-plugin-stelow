import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_OUTPUT_ERROR,
  MAX_AUTO_RETRIES,
  shouldAutoRetryRun,
} from "../lib/transient-run-retry.mjs";

/**
 * The card that asked instead of recovering.
 *
 * On card_a9q5zhzd the scope-map recipe run finished in 0.3s with zero task
 * outputs and zero agent calls — the host proved nothing ran — and the card
 * still parked with a "Retry scope-map run / Waive the run gate" question for
 * the user. A failure with proof that no work happened must be retried by the
 * host, not escalated to a person.
 *
 * These pin the policy, not the mechanism: which error qualifies, that the
 * budget is spent along the chain, and that every other failure still parks.
 */

test("an empty recipe output is retried without asking", () => {
  assert.equal(
    shouldAutoRetryRun({ errorCode: EMPTY_OUTPUT_ERROR, autoRetryCount: 0 }),
    true,
    "proof that nothing ran is the one failure the host may retry alone",
  );
});

test("the budget is spent along the chain, then the card parks", () => {
  assert.equal(MAX_AUTO_RETRIES, 1, "one automatic attempt: a second consecutive no-op is systemic, not transient");
  assert.equal(
    shouldAutoRetryRun({ errorCode: EMPTY_OUTPUT_ERROR, autoRetryCount: 1 }),
    false,
    "a retry that no-ops again exhausts the budget and parks the card",
  );
  assert.equal(
    shouldAutoRetryRun({ errorCode: EMPTY_OUTPUT_ERROR, autoRetryCount: 5 }),
    false,
    "a count past the budget never wraps around",
  );
});

test("a first attempt with no recorded count still qualifies", () => {
  assert.equal(
    shouldAutoRetryRun({ errorCode: EMPTY_OUTPUT_ERROR, autoRetryCount: null }),
    true,
    "rows written before the counter existed read as zero spent",
  );
  assert.equal(
    shouldAutoRetryRun({ errorCode: EMPTY_OUTPUT_ERROR, autoRetryCount: undefined }),
    true,
    "and so does a missing field",
  );
  for (const autoRetryCount of [-1, 0.5, "1", NaN]) {
    assert.equal(
      shouldAutoRetryRun({ errorCode: EMPTY_OUTPUT_ERROR, autoRetryCount }),
      true,
      `${JSON.stringify(autoRetryCount)} is not a spent budget, so it reads as zero`,
    );
  }
});

test("surrounding whitespace does not change the reason", () => {
  // The host stores the trimmed reason, but the policy compares trimmed: a
  // strict-=== implementation would park a padded no-op that proved nothing
  // ran, and the card would ask a person about an empty run again.
  assert.equal(
    shouldAutoRetryRun({ errorCode: `  ${EMPTY_OUTPUT_ERROR}  `, autoRetryCount: 0 }),
    true,
    "padding around the exact reason still qualifies",
  );
});

test("any failure that ran work still parks", () => {
  for (const errorCode of [
    "the host stopped answering about this run",
    "native-start-failed",
    "native-start-timeout",
    "the recipe script reported a failure",
    "the host reported a failure without a reason",
    null,
    undefined,
    "",
    "  ",
  ]) {
    assert.equal(
      shouldAutoRetryRun({ errorCode, autoRetryCount: 0 }),
      false,
      `${JSON.stringify(errorCode)} is not proof of a no-op, so it must not retry alone`,
    );
  }
});

test("a near-miss on the error text does not qualify", () => {
  // The policy keys on the host's exact reason. A prefix match here would let
  // a future message that merely MENTIONS empty outputs trigger a retry of a
  // run that actually did work.
  assert.equal(
    shouldAutoRetryRun({ errorCode: `x${EMPTY_OUTPUT_ERROR}`, autoRetryCount: 0 }),
    false,
    "a wrapping message is not the reason itself",
  );
  assert.equal(
    shouldAutoRetryRun({ errorCode: EMPTY_OUTPUT_ERROR.toUpperCase(), autoRetryCount: 0 }),
    false,
    "and neither is a differently-cased one",
  );
});

console.log("transient run retry test ok: proof of a no-op retries once, everything else parks");
