import assert from "node:assert/strict";
import { cliHarness } from "./helpers/cli-harness.mjs";

// Rework is counted correctly in tests/rework-metrics.test.mjs and the wording
// is owned in tests/metrics-format.test.mjs. What only this file catches is the
// path between them: a finding fixed in one critique artifact and re-opened in
// the next has to survive the trip through the gap state to the readout, and
// the round boundary is exactly the thing that was being lost.

const gaps = (...rows) => rows.map(([description, resolution]) => ({ description, resolution }));

const gapStateWith = (rounds) => ({
  matched: true,
  failures: [],
  escalated: [],
  auditGapScopes: [],
  critiqueText: rounds.map((r) => JSON.stringify(r)).join("\n\n"),
  totals: { total: 2, fixed: 1, documented: 0, escalated: 1 },
  critiqueRounds: rounds,
});

const metricsFor = async (gapState) => {
  const { invoke, card } = cliHarness({ gapState });
  const text = await invoke(["metrics", "--card", card.id]);
  const json = JSON.parse((await invoke(["metrics", "--card", card.id, "--json"])).stdout);
  return { text, json, exitCode: text.exitCode };
};

// --- The signal reaches the readout. ----------------------------------------
{
  const { text, json, exitCode } = await metricsFor(
    gapStateWith([
      gaps(["Login retries on 5xx", "fixed"]),
      gaps(["Login retries on 5xx", "escalate"]),
    ]),
  );
  assert.equal(exitCode, 0);
  assert.match(text.stdout, /Rework: 1 finding\(s\) re-opened/, "a re-opened finding is reported");
  assert.equal(json.rework.rounds, 2, "both rounds are counted");
  assert.equal(json.rework.reworked, 1);
  assert.equal(json.rework.rate, 1, "one reworked finding out of one comparable pass");
  assert.deepEqual(json.rework.descriptions, ["Login retries on 5xx"], "and it is named, so the rate is traceable");
}

// --- A card reviewed once has no convergence to report. ---------------------
{
  const { text, json } = await metricsFor(gapStateWith([gaps(["A", "fixed"])]));
  assert.doesNotMatch(text.stdout, /Rework:/, "one pass prints no rework line at all");
  assert.equal(json.rework.rate, null, "and the rate is absent, not zero");
  assert.equal(json.rework.comparable, undefined, "the payload reports rounds, not a bare zero");
  assert.equal(json.rework.rounds, 1);
}

// --- A converging loop is silent too. --------------------------------------
{
  const { text, json } = await metricsFor(
    gapStateWith([gaps(["A", "fixed"]), gaps(["B", "fixed"]), gaps(["C", "documented"])]),
  );
  assert.doesNotMatch(text.stdout, /Rework:/, "closing everything is not worth a line");
  assert.equal(json.rework.reworked, 0, "but the number is still there for --json");
  assert.equal(json.rework.rate, 0, "and it is a real zero: a measurement, not an absence");
}

// --- A card with no critique at all is not a clean single pass. -------------
{
  const { text, json } = await metricsFor(null);
  assert.doesNotMatch(text.stdout, /Rework:/, "no critique prints nothing");
  assert.equal(json.rework.rounds, 0);
  assert.equal(json.rework.rate, null);
}

// --- The gap line still reads exactly as it did, from the shared owner. -----
// The refactor that introduced the shared formatter must not have changed a
// word a reader or a golden test depends on.
{
  const { text } = await metricsFor(
    gapStateWith([gaps(["A", "fixed"]), gaps(["A", "escalate"])]),
  );
  assert.match(
    text.stdout,
    /Gaps: 2 total · 1 fixed · 0 documented · 1 escalated \(50% escalated\)/,
    "the gap line is unchanged, so the refactor was not a behaviour change",
  );
}

// --- No gaps means the rate is absent, and the gap line is not printed. -----
// A card with no critique report prints no gap line at all: there is nothing to
// report, not a row of zeros. The rate in --json is still absent rather than 0.
{
  const { text, json } = await metricsFor(null);
  assert.doesNotMatch(text.stdout, /Gaps:/, "an uncritiqued card prints no gap line");
  assert.equal(json.escalatedRate, null, "and no escalation rate, rather than a measured 0%");
}

console.log("rework readout ok: a finding that came back is reported, a loop that converged is silent");
