import assert from "node:assert/strict";
import test from "node:test";
import { createCliDispatch } from "../server/runtime/cli-dispatch.ts";
import { createLogCommand } from "../server/runtime/cli/cli-log.ts";

function fakeActions(rows = []) {
  const recorded = [];
  const filters = [];
  return {
    enabled: true,
    recorded,
    filters,
    record(entry) {
      recorded.push(entry);
      return { id: `act_${recorded.length}`, occurrences: 1, deduped: false };
    },
    list(filter = {}) {
      filters.push(filter);
      return rows;
    },
    summarize() {
      return [];
    },
    prune() {
      return { deleted: 0, kept: 0 };
    },
  };
}

const logRow = (overrides) => ({
  id: "act_row",
  at: 1_000,
  lastAt: 1_000,
  kind: "cli.call",
  layer: "intent",
  surface: "cli",
  actor: "agent",
  opId: null,
  cardId: "card_1",
  threadId: null,
  runId: null,
  stage: null,
  outcome: "refused",
  cause: "cli.usage",
  durationMs: null,
  occurrences: 1,
  detail: "{}",
  ...overrides,
});

// ── dispatch: every verb leaves exactly one cli.call row ────────────────────
test("help and unknown commands still record one cli.call row", async () => {
  const actions = fakeActions();
  const dispatch = createCliDispatch({
    run: async (argv) =>
      argv[0] === "nope"
        ? { exitCode: 2, stderr: 'Unknown command "nope".' }
        : { exitCode: 0, stdout: "ran" },
    actions,
    now: () => 2_000,
  });

  const help = await dispatch(["help"], {});
  assert.equal(help.exitCode, 0);
  assert.equal(actions.recorded.length, 1, "help is an invocation, not a gap in the log");
  assert.equal(actions.recorded[0].kind, "cli.call");
  assert.equal(actions.recorded[0].actor, "agent", "CLI invocations are actor=agent, not plugin");
  assert.equal(actions.recorded[0].outcome, "ok");
  assert.equal(actions.recorded[0].cause, null, "a success names no condition");
  assert.equal(actions.recorded[0].detail.verb, "help");
  assert.equal(actions.recorded[0].detail.exitCode, 0);

  const unknown = await dispatch([], {});
  assert.equal(unknown.exitCode, 2, "an empty invocation refuses through the dispatcher");
  assert.equal(actions.recorded.length, 2);
  assert.equal(actions.recorded[1].outcome, "refused");
  assert.equal(actions.recorded[1].cause, "cli.usage", "the unknown-command refusal is countable");
  assert.equal(actions.recorded[1].detail.verb, "", "an empty invocation records an empty verb, not a dropped row");
  assert.equal(actions.recorded[1].detail.exitCode, 2);

  // A named verb the run function does not own is the other unknown path:
  // the composition returns the suggestion refusal, and the wrapper still
  // attributes it to the verb the caller typed.
  const unknownVerb = await dispatch(["nope"], {});
  assert.equal(unknownVerb.exitCode, 2);
  assert.equal(actions.recorded.length, 3);
  assert.equal(actions.recorded[2].outcome, "refused");
  assert.equal(actions.recorded[2].cause, "cli.usage");
  assert.equal(actions.recorded[2].detail.verb, "nope");
});

test("refusal causes are inferred from the exit code or taken from the result verbatim", async () => {
  const actions = fakeActions();
  const results = {
    usage: { exitCode: 2, stderr: "missing --card" },
    refused: { exitCode: 1, stderr: "the gate said no" },
    reasoned: { exitCode: 1, reason: "done.audit-trail", stderr: "no trail" },
    failed: { exitCode: 3, stderr: "crash" },
    ok: { exitCode: 0 },
  };
  const dispatch = createCliDispatch({
    run: async (argv) => results[argv[0]],
    actions,
    now: () => 4_000,
  });

  await dispatch(["usage"], {});
  await dispatch(["refused"], {});
  await dispatch(["reasoned"], {});
  await dispatch(["failed"], {});
  await dispatch(["ok"], {});

  assert.deepEqual(
    actions.recorded.map((entry) => entry.cause),
    ["cli.usage", "cli.refused", "done.audit-trail", "cli.failed", null],
    "exit 2 is usage, exit 1 without a reason is refused, a named reason wins, success has none",
  );
  assert.deepEqual(
    actions.recorded.map((entry) => entry.outcome),
    ["refused", "refused", "refused", "refused", "ok"],
  );
  assert.equal(
    actions.recorded[0].detail.message,
    "missing --card",
    "the first stderr line is kept as evidence",
  );
});

test("a throwing run records cli.exception once and rethrows the original error", async () => {
  const actions = fakeActions();
  const original = new Error("worker crashed\nstack line that must not be stored");
  const dispatch = createCliDispatch({
    run: async () => {
      throw original;
    },
    actions,
    now: () => 6_000,
  });

  let caught;
  try {
    await dispatch(["status"], {});
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, original, "the dispatcher must not wrap the error");
  assert.equal(actions.recorded.length, 1, "one invocation leaves one row, not an ok row plus an error row");
  const entry = actions.recorded[0];
  assert.equal(entry.kind, "cli.call");
  assert.equal(entry.outcome, "error");
  assert.equal(entry.cause, "cli.exception");
  assert.equal(entry.detail.verb, "status");
  assert.equal(entry.detail.message, "worker crashed", "the detail keeps the first line only");
});

test("--card and --card=<id> attribute the row; no --card leaves the card null", async () => {
  const actions = fakeActions();
  const dispatch = createCliDispatch({
    run: async () => ({ exitCode: 0 }),
    actions,
    now: () => 8_000,
  });

  await dispatch(["status", "--card", "card_1"], { threadId: "thr_9" });
  await dispatch(["status", "--card=card_2"], {});
  await dispatch(["status"], {});
  await dispatch(["status", "--card"], {});

  assert.deepEqual(
    actions.recorded.map((entry) => entry.cardId),
    ["card_1", "card_2", null, null],
    "both spellings are attributed and a missing value is not invented",
  );
  assert.equal(
    actions.recorded[0].threadId,
    "thr_9",
    "the invocation's thread is recorded alongside the card",
  );
});

// ── bb stelow log: validation and output ────────────────────────────────────
function logCommand(rows, actions = fakeActions(rows)) {
  const db = { prepare: () => ({ all: () => [] }) };
  return {
    actions,
    command: createLogCommand({ actions, db, now: () => 10_000_000 }),
  };
}

test("the log command ignores verbs it does not own", async () => {
  const { command } = logCommand([]);
  assert.equal(await command(["status"], {}), null);
  assert.equal(await command(["logbook"], {}), null);
});

test("the log command refuses unknown filters and malformed values with exit 2", async () => {
  const { command, actions } = logCommand([]);

  let result = await command(["log", "--kind", "rpc.something-new"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Unknown kind "rpc\.something-new"/);

  result = await command(["log", "--cause", "Not A Cause"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Malformed cause "Not A Cause"/);

  result = await command(["log", "--since", "6H"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Malformed --since "6H"/);

  result = await command(["log", "--since", "0h"], {});
  assert.equal(result.exitCode, 2, "a zero window is malformed, not a filter that matches nothing");

  result = await command(["log", "--limit", "ten"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Malformed --limit "ten"/);

  result = await command(["log", "--outcome", "great"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Unknown outcome "great"/);

  result = await command(["log", "--layer", "weather"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Unknown layer "weather"/);

  assert.equal(actions.filters.length, 0, "a refused invocation never reaches the reader");
});

test("--replay without --card is a usage refusal", async () => {
  const { command, actions } = logCommand([]);
  const result = await command(["log", "--replay"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /--replay needs --card <card_id>/);
  assert.equal(actions.filters.length, 0, "no card means no timeline to collect");
});

test("the log command without a recorder refuses instead of pretending the log is empty", async () => {
  const command = createLogCommand({
    db: { prepare: () => ({ all: () => [] }) },
    now: () => 10_000_000,
  });
  const result = await command(["log"], {});
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason, "log.unavailable");
});

test("the log command reads through the filters it was given", async () => {
  const { command, actions } = logCommand([]);
  await command([
    "log",
    "--card", "card_1",
    "--kind", "cli.call",
    "--cause", "cli.usage",
    "--outcome", "refused",
    "--layer", "intent",
    "--since", "6h",
    "--limit", "5",
  ], {});

  assert.equal(actions.filters.length, 1);
  assert.deepEqual(actions.filters[0], {
    cardId: "card_1",
    kind: "cli.call",
    cause: "cli.usage",
    outcome: "refused",
    layer: "intent",
    since: 10_000_000 - 6 * 3_600_000,
    limit: 5,
  }, "flags become one filter, and --since becomes an absolute timestamp");
});

test("the log command prints rows with their occurrence counts", async () => {
  const rows = [
    logRow({ at: 9_999_000, occurrences: 2, detail: '{"verb":"done","exitCode":2}' }),
    logRow({
      at: 9_998_000,
      kind: "rpc.call",
      surface: "rpc",
      actor: "client",
      outcome: "ok",
      cause: null,
      durationMs: 12,
      detail: "{}",
    }),
  ];
  const { command } = logCommand(rows);
  const result = await command(["log"], {});

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^2 rows · 3 events/, "the header counts rows and occurrences separately");
  assert.match(result.stdout, /refused x2\s+cli\.call cli\.usage card_1/, "a repeated row shows its count");
  assert.match(result.stdout, /rpc\.call/, "the second row is printed too");
  assert.match(result.stdout, /12ms/, "the duration is evidence, not decoration");
});

test("--json returns decoded rows and counts occurrences as events", async () => {
  const rows = [
    logRow({ at: 9_999_000, occurrences: 2, detail: '{"verb":"done","exitCode":2}' }),
    logRow({
      at: 9_998_000,
      kind: "rpc.call",
      surface: "rpc",
      actor: "client",
      outcome: "ok",
      cause: null,
      detail: "{}",
    }),
  ];
  const { command } = logCommand(rows);
  const result = await command(["log", "--json"], {});

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.rows, 2);
  assert.equal(payload.events, 3, "events sums occurrences, not rows");
  assert.equal(payload.since, null);
  assert.deepEqual(payload.actions[0].detail, { verb: "done", exitCode: 2 }, "detail is decoded for --json");
  assert.equal(payload.actions[0].occurrences, 2);
});

console.log("action log wiring test ok: dispatch attribution, refusal causes, log validation and output");
