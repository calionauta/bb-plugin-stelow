import assert from "node:assert/strict";
import {
  GATE_INSTRUMENTS,
  exitCodeFor,
  instrumentResult,
  planGate,
  renderSummary,
  summarize,
} from "../lib/audit-gate.mjs";

/**
 * The gate's verdict, which is the only part worth testing.
 *
 * The audit found two blockers that a gate already knew how to catch and simply
 * never ran together — a tree that matches a pin nobody released, and a pin that
 * does not answer the verb the host calls. The value of the gate is therefore
 * entirely in the verdict logic: fail closed, name what failed, and never report
 * the same green after dropping an instrument it could not run.
 *
 * Fail-closed is asserted by construction here, not by inspection: a result that
 * is not an explicit pass counts as a failure, so a crashed runner, a timeout, a
 * missing exit code and a thrown assert all land on the same side.
 */

// --- The instruments -------------------------------------------------------
{
  const ids = GATE_INSTRUMENTS.map((instrument) => instrument.id);
  assert.deepEqual([...new Set(ids)], ids, "instrument ids are unique");
  for (const instrument of GATE_INSTRUMENTS) {
    assert.ok(instrument.label.length > 0, `${instrument.id} names itself`);
    assert.ok(instrument.command.length > 0, `${instrument.id} carries a command`);
  }
  const lastInstrument = GATE_INSTRUMENTS.at(-1);
  assert.equal(lastInstrument.network, true, "the network instrument runs last, after the cheap ones");
}

// --- Planning never narrows silently --------------------------------------
{
  const full = planGate();
  assert.equal(full.planned.length, GATE_INSTRUMENTS.length, "the default plan runs every instrument");
  assert.deepEqual(full.skipped, [], "the default plan skips nothing");

  const offline = planGate({ offline: true });
  assert.ok(
    offline.planned.every((instrument) => !instrument.network),
    "offline runs only the instruments that do not need the network",
  );
  assert.deepEqual(
    offline.skipped,
    GATE_INSTRUMENTS.filter((instrument) => instrument.network).map((instrument) => instrument.id),
    "offline names every instrument it dropped",
  );
  assert.ok(offline.skipped.length > 0, "offline actually drops something — otherwise the flag is a lie");
}

// --- A verdict per instrument ---------------------------------------------
{
  const instrument = { id: "drift", label: "tree equals the pin" };
  assert.equal(instrumentResult(instrument, 0).status, "pass", "exit 0 passes");
  assert.equal(instrumentResult(instrument, 1).status, "fail", "a non-zero exit fails");
  assert.equal(instrumentResult(instrument, 2).status, "fail", "any non-zero exit fails");
  assert.equal(instrumentResult(instrument, null).status, "fail", "a missing exit code (crash, timeout) fails");
  assert.equal(instrumentResult(instrument, undefined).status, "fail", "an undefined exit code fails");
  assert.equal(instrumentResult(instrument, null).code, 1, "a missing exit code reads as 1, not as 0");
}

// --- The verdict over every result ----------------------------------------
{
  const green = summarize([
    { id: "drift", status: "pass" },
    { id: "verbs", status: "pass" },
  ]);
  assert.equal(green.ok, true, "all green is green");
  assert.deepEqual(green.failed, [], "green names no failure");
  assert.equal(exitCodeFor(green), 0, "green exits zero");

  const red = summarize([
    { id: "drift", status: "pass" },
    { id: "provenance", status: "fail", code: 1 },
  ]);
  assert.equal(red.ok, false, "one red instrument is red");
  assert.deepEqual(red.failed, ["provenance"], "the failure names the instrument, not a generic error");
  assert.equal(exitCodeFor(red), 1, "red exits non-zero");

  const unknown = summarize([{ id: "moves", status: "skipped" }]);
  assert.equal(unknown.ok, false, "a status that is not `pass` is a failure — fail closed");
  assert.deepEqual(unknown.failed, ["moves"], "an unknown status is named as the failure it is");

  assert.equal(exitCodeFor(undefined), 1, "no summary at all is not a pass");
  assert.equal(exitCodeFor({}), 1, "an empty summary is not a pass");
}

// --- The summary line tells the truth about skips -------------------------
{
  const green = summarize([{ id: "drift", status: "pass" }]);
  assert.match(renderSummary(green), /GREEN/, "a full green says GREEN");
  assert.doesNotMatch(renderSummary(green), /not verified/, "a full green claims nothing was skipped");

  const offlineLine = renderSummary({ ...green, skipped: ["provenance"] });
  assert.match(offlineLine, /GREEN/, "offline is still green for what it ran");
  assert.match(offlineLine, /provenance not verified/, "but it names what it did not verify");
  assert.match(offlineLine, /--offline/, "and names the flag that caused it");

  const redLine = renderSummary(summarize([{ id: "verbs", status: "fail" }]));
  assert.match(redLine, /RED/, "a failure reads as RED");
  assert.match(redLine, /verbs/, "and names the instrument");
}

console.log("audit gate ok: fail-closed verdict, named failures, offline drops are reported");
