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
    "Which slice ships first?",
    "--option",
    "First slice ships first",
    "--option",
    "Second slice ships first",
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
    "Which slice ships first?",
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
    "Which slice ships first?",
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
    "Which slice ships first?",
    "--option",
    "First slice ships first",
    "--option",
    "Second slice ships first",
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /already open|pending/i);
  assert.deepEqual(callsNamed(calls, "requestInput"), []);
});

test("a placeholder probe never reaches the human", async () => {
  // Regression pin for card_48uuhus1: a worker probing "is a question already
  // pending?" ran --question "ping" --option "a" --option "b", and the host
  // interrupted a human with a nonsense form. The ask never fired.
  const { invoke, calls } = cliHarness();
  const result = await invoke([
    "ask",
    "--thread",
    "thr_worker",
    "--question",
    "ping",
    "--option",
    "a",
    "--option",
    "b",
  ]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /placeholder/);
  assert.deepEqual(
    callsNamed(calls, "requestInput"),
    [],
    "a probe must never open an interaction",
  );
  const persisted = calls.find(
    ([entry, sql]) => entry === "run" && sql.includes("expired_questions"),
  );
  assert.equal(persisted, undefined, "a refused ask is not persisted as answerable");
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
    "Which slice ships first?",
    "--option",
    "First slice ships first",
    "--option",
    "Second slice ships first",
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /STOP and wait/);
  const expired = calls.find(
    ([entry, sql]) => entry === "run" && sql.includes("expired_questions"),
  );
  assert.ok(expired, "the question stays answerable on the card");
  assert.equal(expired[2][3], "Which slice ships first?");
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.activity),
    ["awaiting-answer", "running", "awaiting-answer"],
    "the card shows the question waiting, leaves the wait when the call ends, and is re-marked waiting once the question is persisted",
  );
});

test("an answered ask cancels its early sync kick instead of leaking the timer", async () => {
  // blockOnAnswer schedules kickQuestionSync (1500ms) so the inbox row appears while the card already
  // shows the question, then must cancel it once requestAnswer settles — otherwise a post-answer sync
  // fires against resolved state. Timers are stubbed so the 1500ms kick is observable without waiting;
  // only the kick delay is counted, so unrelated host timers cannot flake the pin.
  const { invoke } = cliHarness({
    requestInput: () => ({ outcome: "submitted", value: { answers: [] } }),
  });
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const cleared = [];
  globalThis.setTimeout = (cb, ms) => { scheduled.push(ms); return { unref() {}, __cb: cb }; };
  globalThis.clearTimeout = (timer) => { cleared.push(timer); };
  try {
    const result = await invoke([
      "ask", "--thread", "thr_worker", "--question", "Which slice ships first?",
      "--option", "First slice ships first", "--option", "Second slice ships first",
    ]);
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
  assert.equal(scheduled.filter((ms) => ms === 1500).length, 1, "the live ask schedules exactly one early sync kick");
  assert.equal(cleared.length, 1, "settling the answer cancels the kick instead of leaking a post-answer sync");
});

test("a persisted timeout ask kicks an early sync for its expired rows", async () => {
  // writeExpiredRows mints the expired rows' inbox row through the same kick as the live path. The live
  // kick was already cancelled when the call ended, so the timeout path schedules twice and clears once.
  const { invoke, calls } = cliHarness({
    requestInput: () => ({ outcome: "cancelled", reason: "timeout" }),
  });
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const cleared = [];
  globalThis.setTimeout = (cb, ms) => { scheduled.push(ms); return { unref() {}, __cb: cb }; };
  globalThis.clearTimeout = (timer) => { cleared.push(timer); };
  try {
    const result = await invoke([
      "ask", "--thread", "thr_worker", "--question", "Which slice ships first?",
      "--option", "First slice ships first", "--option", "Second slice ships first",
    ]);
    assert.equal(result.exitCode, 1);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
  const expired = calls.find(
    ([entry, sql]) => entry === "run" && sql.includes("expired_questions"),
  );
  assert.ok(expired, "the question stays answerable on the card");
  assert.equal(scheduled.filter((ms) => ms === 1500).length, 2, "the expired-row write schedules its own early sync kick");
  assert.equal(cleared.length, 1, "only the live-path kick is cancelled; the expired-row kick fires");
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
    "First slice ships first",
    "--option",
    "Second slice ships first",
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
