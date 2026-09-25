import assert from "node:assert/strict";
import test from "node:test";
import { callsNamed, firstCall, cliHarness } from "./helpers/cli-harness.mjs";

/** The blocking ask: every refusal happens before the host call, and an
 * unanswered question is persisted instead of lost. */

test("ask refuses a thread that owns no card", async () => {
  const { invoke, calls } = cliHarness();
  const result = await invoke([
    "ask",
    "--thread",
    "thr_other",
    "--question",
    "Q?",
    "--option",
    "A",
    "--option",
    "B",
  ]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /No card owns thread "thr_other"/);
  assert.deepEqual(
    callsNamed(calls, "requestInput"),
    [],
    "a threadless ask never pings the human",
  );
});

test("ask refuses --locale: question content is English-only", async () => {
  const { invoke, calls } = cliHarness();
  const result = await invoke([
    "ask",
    "--thread",
    "thr_worker",
    "--question",
    "Q?",
    "--locale",
    "pt",
  ]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /English-only/);
  assert.deepEqual(callsNamed(calls, "requestInput"), []);
});

test("ask refuses an unknown --tag by name", async () => {
  const { invoke, calls } = cliHarness();
  const result = await invoke([
    "ask",
    "--thread",
    "thr_worker",
    "--tag",
    "merge",
    "--question",
    "Q?",
  ]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /--tag split/);
  assert.deepEqual(callsNamed(calls, "requestInput"), []);
});

test("ask with an open question refuses before the human is pinged again", async () => {
  const { invoke, calls } = cliHarness({
    pendingAsks: [{ id: "int_1", status: "pending" }],
  });
  const result = await invoke([
    "ask",
    "--thread",
    "thr_worker",
    "--question",
    "Q?",
    "--option",
    "A",
    "--option",
    "B",
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /already open|pending/i);
  assert.deepEqual(callsNamed(calls, "requestInput"), []);
});

test("an unanswered ask is persisted as an expired row, never dropped", async () => {
  const { invoke, calls } = cliHarness({
    requestInput: () => ({ outcome: "cancelled", reason: "timeout" }),
  });
  const result = await invoke([
    "ask",
    "--thread",
    "thr_worker",
    "--question",
    "Q?",
    "--option",
    "A",
    "--option",
    "B",
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /STOP and wait/);
  const expired = calls.find(
    ([entry, sql]) => entry === "run" && sql.includes("expired_questions"),
  );
  assert.ok(expired, "the question stays answerable on the card");
  assert.equal(expired[2][3], "Q?");
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.activity),
    ["awaiting-answer", "running", "awaiting-answer"],
    "the card shows the question waiting, leaves the wait when the call ends, and is re-marked waiting once the question is persisted",
  );
});

test("a submitted ask records the split selection the executor trusts", async () => {
  const { invoke, calls } = cliHarness({
    stage: "triage",
    requestInput: () => ({
      outcome: "submitted",
      value: { answers: ["First slice", "Keep as one card"] },
    }),
  });
  const result = await invoke([
    "ask",
    "--thread",
    "thr_worker",
    "--tag",
    "split",
    "--question",
    "Split?",
    "--option",
    "First slice",
    "--desc",
    "Ship the retry path",
    "--option",
    "Second slice",
    "--desc",
    "Ship the receipt",
    "--option",
    "Keep as one card",
    "--multiple",
  ]);
  assert.equal(result.exitCode, 0);
  const proposal = calls.find(
    ([entry, sql]) => entry === "run" && sql.includes("split_proposals"),
  );
  assert.ok(proposal, "the proposal is recorded before the blocking call");
  const selected = calls.find(
    ([entry, sql]) => entry === "run" && sql.startsWith("UPDATE split_proposals"),
  );
  assert.ok(selected, "the approval is recorded after the answer");
  assert.equal(selected[2][0], '["First slice","Keep as one card"]');
});

test("a split ask needs exactly one keep option", async () => {
  const { invoke, calls } = cliHarness({ stage: "triage" });
  const result = await invoke([
    "ask",
    "--thread",
    "thr_worker",
    "--tag",
    "split",
    "--question",
    "Split?",
    "--option",
    "First slice",
    "--desc",
    "Ship the retry path",
    "--option",
    "Second slice",
    "--desc",
    "Ship the receipt",
    "--multiple",
  ]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /exactly one "Keep as one card"/);
  assert.deepEqual(callsNamed(calls, "requestInput"), []);
});

test("a standard ask at the split point carries the consequence disclosure", async () => {
  const { invoke, calls } = cliHarness({ stage: "triage" });
  await invoke([
    "ask",
    "--thread",
    "thr_worker",
    "--question",
    "Split this card?",
    "--option",
    "A",
    "--option",
    "B",
  ]);
  // The rendered question travels in the interaction payload, so the
  // disclosure is observable where the human reads it.
  const [, payload] = firstCall(calls, "requestInput");
  assert.match(payload.payload.question, /it creates no new cards/);
  assert.match(
    payload.payload.question,
    /Propose split/,
    "the disclosure names the repair the human can still take",
  );
});
