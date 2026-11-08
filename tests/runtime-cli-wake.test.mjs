import assert from "node:assert/strict";
import test from "node:test";
import { createWakeCommand } from "../server/runtime/cli/cli-wake.ts";

/** Card shapes that must all produce a skip the host recognises. */
const REFUSAL_CASES = [
  { activity: "awaiting-answer" },
  { activity: "running" },
  { status: "completed", activity: "idle" },
  { status: "archived", activity: "idle" },
  { activity: "idle", auto_continue_count: 10 },
  { activity: "idle", last_error: "boom", auto_continue_count: 10 },
  { activity: "idle", read_miss_since: 5 },
  { activity: "held" },
];

// The `bb stelow wake` verb: the shell around lib/wake-gate.mjs.
//
// lib/wake-gate.test.mjs owns the DECISION. This file owns the CONTRACT with
// the host, and the contract is the reason the verb exists at all: the
// automations plugin decides "this tick did nothing" by parsing the last
// non-empty stdout line of a script run and requiring `wakeAgent === false`.
// If the shape drifts — a prefix, a log line, `wakeAgent: "false"` — the
// sentinel silently stops skipping, the expensive loop comes back, and nothing
// reports an error. So these assertions are exact-string, not `match`.

function fixtureCard(overrides = {}) {
  return {
    id: "card_1",
    status: "in-progress",
    activity: "idle",
    stage: "build",
    last_error: null,
    last_idle_at: 1_000,
    auto_continue_count: 0,
    read_miss_since: null,
    ...overrides,
  };
}

function run(card, argv = [], ctx = {}) {
  return harness(card).run(argv, ctx);
}

/**
 * One command instance, callable across ticks — the only way to test the gate's
 * memory, since the memory lives in that instance.
 */
function harness(initial) {
  const cards = new Map();
  if (initial) cards.set(initial.id, initial);
  const deps = {
    now: () => 2_000,
    getCard: (id) => cards.get(id),
    getCardByWorkerThread: (threadId) =>
      [...cards.values()].find((entry) => entry.worker_thread_id === threadId),
  };
  const command = createWakeCommand(deps);
  return {
    setCard(card) {
      cards.set(card.id, card);
    },
    run: (argv = [], ctx = {}) => command(argv, { threadId: null, projectId: "proj_1", ...ctx }),
  };
}

test("a refusal prints exactly the host's silent-skip line", async () => {
  const result = await run(fixtureCard({ activity: "awaiting-answer" }), ["wake", "--card", "card_1"]);
  assert.equal(result.exitCode, 0);
  // Exact string: see the file header. A single extra character here and the
  // host stops recognising the skip.
  assert.equal(result.stdout, '{"wakeAgent": false}');
});

test("the skip line is parseable as JSON with wakeAgent === false", async () => {
  for (const overrides of REFUSAL_CASES) {
    const result = await run(fixtureCard(overrides), ["wake", "--card", "card_1"]);
    const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.equal(parsed.wakeAgent, false, `not a skip line for ${JSON.stringify(overrides)}`);
  }
});

test("a wake prints its reason and never the skip line", async () => {
  const result = await run(fixtureCard(), ["wake", "--card", "card_1"]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.length > 0, "a wake must say why, or the run reads as a silent skip");
  assert.doesNotMatch(result.stdout, /wakeAgent/);
  assert.match(result.stdout, /parked idle/);
});

test("--json carries the verdict, the reason, and the card", async () => {
  const result = await run(fixtureCard({ activity: "awaiting-answer" }), [
    "wake", "--card", "card_1", "--json",
  ]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.wake, false);
  assert.equal(parsed.cardId, "card_1");
  assert.match(parsed.reason, /waiting on a human answer/);
});

test("no card at all is a loud exit 2, never a silent skip", async () => {
  // The dangerous regression: a gate that skipped on a misconfiguration would
  // hide the automation forever. Exit 2 with stderr is the only answer that
  // surfaces in the run history.
  const result = await run(null, ["wake"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /No card in context/);
  assert.equal(result.stdout, undefined);
});

test("an unknown --card is a loud exit 2, not a skip", async () => {
  const result = await run(fixtureCard(), ["wake", "--card", "card_missing"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Unknown card/);
});

test("the verb claims nothing but its own name", async () => {
  const result = await run(fixtureCard(), ["status"]);
  assert.equal(result, null, "another family's verb must fall through untouched");
});

test("a card found through the calling thread needs no --card flag", async () => {
  const card = fixtureCard({ worker_thread_id: "thr_1" });
  const result = await run(card, ["wake"], { threadId: "thr_1" });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /parked idle/);
});

test("a card that has not moved since its last visit is skipped on the next tick", async () => {
  // The gap this closes: before the memory, an idle card answered "yes" on
  // every tick, so the sentinel would wake the worker every 20 minutes for as
  // long as the worker kept parking without advancing — the same loop the gate
  // exists to break, one sentinel later.
  const gate = harness(fixtureCard());
  const first = await gate.run(["wake", "--card", "card_1"]);
  assert.equal(first.stdout, "card parked idle for 1s with an unfinished stage");

  const second = await gate.run(["wake", "--card", "card_1"]);
  assert.equal(second.exitCode, 0);
  assert.equal(second.stdout, '{"wakeAgent": false}');
});

test("a stage advance after a visit earns a new one", async () => {
  const gate = harness(fixtureCard());
  await gate.run(["wake", "--card", "card_1"]);

  gate.setCard(fixtureCard({ stage: "review" }));
  const next = await gate.run(["wake", "--card", "card_1"]);
  assert.notEqual(next.stdout, '{"wakeAgent": false}');
  assert.match(next.stdout, /parked idle/);
});

test("a failure appearing after a visit earns a new one", async () => {
  const gate = harness(fixtureCard());
  await gate.run(["wake", "--card", "card_1"]);

  gate.setCard(fixtureCard({ last_error: "boom" }));
  const next = await gate.run(["wake", "--card", "card_1"]);
  assert.match(next.stdout, /card has an error/);
});

test("a refusal does not erase what the last visit saw", async () => {
  // The memory records spent turns, not observations. A refusal spends none, so
  // a card that parks on a human and later returns to the state it was last
  // visited in is still the state a turn was already spent on.
  const gate = harness(fixtureCard());
  await gate.run(["wake", "--card", "card_1"]);

  gate.setCard(fixtureCard({ activity: "awaiting-answer" }));
  const parked = await gate.run(["wake", "--card", "card_1"]);
  assert.equal(parked.stdout, '{"wakeAgent": false}');

  gate.setCard(fixtureCard());
  const after = await gate.run(["wake", "--card", "card_1"]);
  assert.equal(after.stdout, '{"wakeAgent": false}', "the same state is still the visited one");
});
