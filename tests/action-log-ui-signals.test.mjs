// Two new signals, one shared failure mode: a row that records the right
// number and the wrong identity.
//
// `ui.error` written with a constant cause collapses every distinct browser
// failure in the recorder's dedupe window into one row — the count is right and
// the answer is gone. So the cause has to group the volatile parts of a message
// (ids, counts, request ids) and still separate genuinely different failures.
//
// `host.read-miss` has the opposite risk: a row written per tick turns one
// outage into a flood. It must be written exactly once, on the tick the streak
// crosses the threshold, and again only after the host has answered.
import assert from "node:assert/strict";
import test from "node:test";
import { isActionCause } from "../lib/action-kinds.mjs";
import { clientErrorCause, normalizeClientError } from "../lib/client-error-cause.mjs";
import { READ_STREAK_WARN_AT } from "../lib/host-read-streak.mjs";
import { reportClientError } from "../server/runtime/client-error-report.ts";
import { createReadStreaks } from "../server/runtime/read-streak-wiring.ts";

function collectingActions() {
  const recorded = [];
  return {
    recorded,
    enabled: true,
    record(entry) {
      recorded.push(entry);
      return { id: `act_${recorded.length}`, occurrences: 1, deduped: false };
    },
  };
}

function collectingBb() {
  const warnings = [];
  return { warnings, bb: { log: { warn: (message) => warnings.push(message) } } };
}

// ── normalizeClientError: the fingerprint's input ───────────────────────────
test("normalizeClientError masks digits, uuids, hex tokens and quoted values", () => {
  assert.equal(
    normalizeClientError("Failed to read card_1234 after 3 tries"),
    "failed to read card_# after # tries",
  );

  const uuid = normalizeClientError("request 123E4567-E89B-12D3-A456-426614174000 failed");
  assert.equal(uuid, "request # failed");
  assert.equal(uuid.split("#").length - 1, 1, "a uuid is one mask, not a dash-split series");

  assert.equal(normalizeClientError("token deadbeefcafe1234 rejected"), "token # rejected");
  assert.equal(normalizeClientError('error reading "card_1" field'), "error reading _ field");
  assert.equal(normalizeClientError("error reading 'card_1' field"), "error reading _ field");
});

test("normalizeClientError fingerprints the first line with collapsed whitespace", () => {
  const firstLine = normalizeClientError("  Card   1234\nread failed 99 times\nthird  ");
  assert.equal(firstLine, "card #");
  assert.ok(!firstLine.includes("read failed"), "only the first line reaches the fingerprint");
  assert.equal(normalizeClientError("  spaced\t\tout   text  "), "spaced out text");
});

test("normalizeClientError answers unknown for nothing and never exceeds 160 characters", () => {
  for (const empty of ["", "   ", undefined, null]) {
    assert.equal(normalizeClientError(empty), "unknown");
  }

  const capped = normalizeClientError("x".repeat(300));
  assert.equal(capped.length, 160);
  assert.equal(capped, "x".repeat(160));
});

// ── clientErrorCause: the action-log cause ──────────────────────────────────
test("clientErrorCause renders ui.error.<surface>.<8 hex> and is always a valid cause", () => {
  const cause = clientErrorCause("Board / Detail", "Timed out reading card_1");
  assert.match(cause, /^ui\.error\.board-detail\.[0-9a-f]{8}$/);
  assert.equal(isActionCause(cause), true);

  const surfaces = ["", "   ", "Board / Detail", "404 panel", "SÜRFACE", "a b ".repeat(20), "///"];
  for (const surface of surfaces) {
    const candidate = clientErrorCause(surface, "boom");
    assert.equal(isActionCause(candidate), true, `surface ${JSON.stringify(surface)} produced ${candidate}`);
    assert.ok(candidate.length <= 64);
  }
});

test("clientErrorCause falls back to app when the surface slug is empty", () => {
  assert.match(clientErrorCause("", "boom"), /^ui\.error\.app\.[0-9a-f]{8}$/);
  assert.match(clientErrorCause(undefined, "boom"), /^ui\.error\.app\.[0-9a-f]{8}$/);
});

test("clientErrorCause groups messages that differ only by a number or a uuid", () => {
  assert.equal(
    clientErrorCause("board", "timed out after 30 seconds"),
    clientErrorCause("board", "timed out after 60 seconds"),
  );
  assert.equal(
    clientErrorCause("board", "failed request 11111111-2222-3333-4444-555555555555"),
    clientErrorCause("board", "failed request 99999999-8888-7777-6666-555555555555"),
  );
  assert.equal(
    clientErrorCause("sync", "failed to read card_1"),
    clientErrorCause("sync", "failed to read card_2"),
  );
});

test("clientErrorCause groups messages that differ only by a host card id", () => {
  // Host card ids are `card_` plus eight base36 characters (`card_cbnihg4c`),
  // so most of them carry letters and digits. A digits-only mask leaves the
  // letters in the fingerprint and turns one recurring error on two cards into
  // two causes, which is the split this cause exists to prevent.
  assert.equal(
    clientErrorCause("sync", "Failed to read card card_cbnihg4c"),
    clientErrorCause("sync", "Failed to read card card_hh2nwqs4"),
  );
});

test("clientErrorCause separates genuinely different failures", () => {
  assert.notEqual(
    clientErrorCause("board", "network unreachable"),
    clientErrorCause("board", "permission denied"),
  );
  assert.notEqual(
    clientErrorCause("board", "read failed"),
    clientErrorCause("detail", "read failed"),
    "the surface is part of a cause's identity",
  );
});

// ── reportClientError: the ui.error row ─────────────────────────────────────
test("reportClientError records one ui.error row keyed by the message fingerprint", () => {
  const actions = collectingActions();
  const input = {
    surface: "Board / Detail",
    message: "Failed to read card_1234",
    stack: "Error: nope\n    at render",
    cardId: "card_1",
  };

  const result = reportClientError(actions, input);

  assert.deepEqual(result, { ok: true });
  assert.equal(actions.recorded.length, 1);
  const [row] = actions.recorded;
  assert.equal(row.kind, "ui.error");
  assert.equal(row.actor, "client");
  assert.equal(row.outcome, "error");
  assert.equal(row.cause, clientErrorCause(input.surface, input.message));
  assert.equal(isActionCause(row.cause), true);
  assert.equal(row.cardId, "card_1");
  assert.equal(row.detail.surface, "Board / Detail");
  assert.equal(row.detail.message, "Failed to read card_1234");
  assert.equal(row.detail.stack, "Error: nope\n    at render");
});

test("reportClientError leaves cardId and stack null when the input omits them", () => {
  const actions = collectingActions();
  reportClientError(actions, { surface: "promise", message: "boom" });

  const [row] = actions.recorded;
  assert.equal(row.cardId, null);
  assert.equal(row.detail.stack, null);
});

test("reportClientError caps surface, message and stack before writing", () => {
  const actions = collectingActions();
  const surface = "s".repeat(80);
  const message = "m".repeat(500);
  const stack = "t".repeat(2_000);

  reportClientError(actions, { surface, message, stack });

  const [row] = actions.recorded;
  assert.equal(row.detail.surface.length, 40);
  assert.equal(row.detail.message.length, 400);
  assert.equal(row.detail.stack.length, 1_200);
  assert.equal(
    row.cause,
    clientErrorCause(surface, message),
    "the cause fingerprints the whole message, not the capped copy",
  );
});

test("reportClientError still answers ok when the recorder is disabled", () => {
  const attempts = [];
  const disabled = {
    enabled: false,
    record(entry) {
      attempts.push(entry);
      return null; // the real disabled recorder writes no row and does not throw
    },
  };

  assert.deepEqual(reportClientError(disabled, { surface: "window", message: "boom" }), { ok: true });
  assert.equal(attempts.length, 1, "the reporter hands the entry over once and does not retry");
});

// ── createReadStreaks: warn plus one host.read-miss row per outage ──────────
test("the sixth consecutive read miss warns once and records one host.read-miss row", () => {
  assert.equal(READ_STREAK_WARN_AT, 6);
  const { warnings, bb } = collectingBb();
  const actions = collectingActions();
  const streaks = createReadStreaks(bb, actions);

  for (let miss = 0; miss < READ_STREAK_WARN_AT - 1; miss += 1) {
    assert.equal(streaks.unreadable("card_1"), miss + 1);
  }
  assert.equal(warnings.length, 0, "five misses are not an outage worth reporting");
  assert.equal(actions.recorded.length, 0);

  assert.equal(streaks.unreadable("card_1"), READ_STREAK_WARN_AT);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("card_1"), "the operator line names the card");
  assert.equal(actions.recorded.length, 1);

  const [row] = actions.recorded;
  assert.equal(row.kind, "host.read-miss");
  assert.equal(row.outcome, "error");
  assert.equal(row.cause, "host.read-miss");
  assert.equal(isActionCause(row.cause), true);
  assert.equal(row.cardId, "card_1");
  assert.deepEqual(row.detail, { streak: READ_STREAK_WARN_AT });

  streaks.unreadable("card_1");
  assert.equal(warnings.length, 1, "the seventh miss belongs to the same outage");
  assert.equal(actions.recorded.length, 1, "one outage, one row");
});

test("a readable read clears the streak so the next outage warns and records again", () => {
  const { warnings, bb } = collectingBb();
  const actions = collectingActions();
  const streaks = createReadStreaks(bb, actions);

  for (let miss = 0; miss < READ_STREAK_WARN_AT; miss += 1) streaks.unreadable("card_1");
  assert.equal(warnings.length, 1);
  assert.equal(actions.recorded.length, 1);

  streaks.readable("card_1");
  assert.equal(streaks.streakOf("card_1"), 0);

  for (let miss = 0; miss < READ_STREAK_WARN_AT - 1; miss += 1) streaks.unreadable("card_1");
  assert.equal(warnings.length, 1, "five misses after recovery are not a second outage");
  assert.equal(actions.recorded.length, 1);

  streaks.unreadable("card_1");
  assert.equal(warnings.length, 2, "the second outage must not be silent");
  assert.equal(actions.recorded.length, 2);
  assert.deepEqual(actions.recorded[1].detail, { streak: READ_STREAK_WARN_AT });
  assert.equal(actions.recorded[1].cardId, "card_1");
});

test("each card keeps its own read streak", () => {
  const { warnings, bb } = collectingBb();
  const actions = collectingActions();
  const streaks = createReadStreaks(bb, actions);

  for (let miss = 0; miss < READ_STREAK_WARN_AT - 1; miss += 1) {
    streaks.unreadable("card_1");
    streaks.unreadable("card_2");
  }
  assert.equal(warnings.length, 0, "two half-streaks are not one outage");
  assert.equal(actions.recorded.length, 0);

  streaks.unreadable("card_1");
  assert.equal(warnings.length, 1);
  assert.equal(actions.recorded[0].cardId, "card_1");

  streaks.unreadable("card_2");
  assert.equal(warnings.length, 2);
  assert.equal(actions.recorded[1].cardId, "card_2");
  assert.deepEqual(
    actions.recorded.map((row) => row.detail.streak),
    [READ_STREAK_WARN_AT, READ_STREAK_WARN_AT],
  );
});

test("the streak still warns when no recorder is wired", () => {
  const { warnings, bb } = collectingBb();
  const streaks = createReadStreaks(bb);

  assert.doesNotThrow(() => {
    for (let miss = 0; miss < READ_STREAK_WARN_AT; miss += 1) streaks.unreadable("card_1");
  });
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("card_1"));
});
