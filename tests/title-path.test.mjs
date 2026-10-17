/**
 * The title path's record, guard, and retry wiring.
 *
 * The docstring below used to stand in for the harness: these cases drive
 * `createTitleBurst` with a fake host, so what is asserted is what a burst DID
 * (which spawns, which polls, which writes, which trail lines) rather than what
 * its source says. A source pin passed when a branch was hoisted behind an
 * earlier return; a driven burst cannot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCardName } from "../lib/draft-burst.mjs";
import { createTitleBurst } from "../server/title-burst.ts";

const drafting = readFileSync(new URL("../server/drafting.ts", import.meta.url), "utf8");

/**
 * The host a burst sees, with every side effect recorded. `completions` lets a
 * case script one poll result per attempt, which is what a retry needs.
 */
function burstFixture(overrides = {}) {
  const calls = { comments: [], publishes: [], logs: [], written: [], waits: [], spawns: 0 };
  const card = {
    id: overrides.cardId ?? "card_title",
    project_id: "project_1",
    prompt: "Build the thing",
    kind: "build",
    display_name: "Card One",
    name: "Card One",
    status: "in-progress",
    archived: false,
  };
  const deps = {
    getCard: () => (overrides.gone ? null : card),
    isArchivedCard: (value) => Boolean(value.archived),
    resolveGenerationPreset: () => {
      if (overrides.presetThrows) throw new Error("preset broken");
      return { preset: { id: "preset_1", name: "Primary" }, source: overrides.presetSource ?? null };
    },
    presetParams: () => ({}),
    stopThread: async () => {},
    comment: (cardId, body) => {
      if (overrides.commentThrows) throw new Error("comment refused");
      calls.comments.push([cardId, body]);
    },
    publish: (event, payload) => {
      if (overrides.publishThrows) throw new Error("publish refused");
      calls.publishes.push([event, payload]);
    },
    readOutput: async () => overrides.output ?? "A generated title",
    waitForThread: async (_threadId, polls) => {
      const attempt = calls.waits.push(polls) - 1;
      overrides.onWait?.(card, attempt);
      return overrides.completions?.[attempt] ?? { status: "idle", timedOut: false };
    },
    writeTitle: (cardId, name) => calls.written.push([cardId, name]),
    log: (message) => calls.logs.push(message),
    spawnTitle: async () => {
      calls.spawns += 1;
      if (overrides.spawnThrows) throw new Error("spawn refused");
      return { id: `thread_${calls.spawns}` };
    },
  };
  return { deps, calls, card, suggest: createTitleBurst(deps) };
}

test("a human rename still wins: renamed_mid_burst writes neither a name nor a record", async () => {
  const { classifyTitleOutcome, isRecordable } = await import("../lib/title-outcome.mjs");
  const outcome = classifyTitleOutcome({
    spawned: true,
    completion: { status: "idle", timedOut: false },
    output: "A generated title",
    validated: { ok: true, name: "A generated title" },
    live: { title: "What the human typed" },
    originalTitle: "What the request said",
  });
  assert.equal(outcome, "renamed_mid_burst");
  assert.equal(isRecordable(outcome), false, "a human just named it; a comment there is noise");

  // Driven: the card is renamed between the spawn and the classification.
  const f = burstFixture({
    onWait: (card) => {
      card.name = "What the human typed";
      card.display_name = "What the human typed";
    },
  });
  await f.suggest("card_title");
  assert.deepEqual(f.calls.written, [], "a rename is never overwritten");
  assert.deepEqual(f.calls.comments, [], "and the rename itself leaves no comment");
});

test("an archived card is never renamed, and the guard reads the live card", async () => {
  // Archived mid-burst, after the card was read for spawning: the pre-burst
  // snapshot says live, so only a re-read catches this.
  const f = burstFixture({ onWait: (card) => { card.archived = true; } });
  await f.suggest("card_title");
  assert.deepEqual(f.calls.written, [], "an archived card is never renamed");
  assert.deepEqual(f.calls.comments, [], "and takes no trail write either");
  assert.ok(
    f.calls.logs.some((message) => /archived/.test(message)),
    "the unrecorded outcome is still logged, not silently dropped",
  );
});

test("the record is guarded so a failed comment never fails a delivery", async () => {
  // A recordable outcome (no output) whose comment write throws: the burst must
  // resolve, and the missing record must say so rather than vanish.
  const f = burstFixture({ output: "", commentThrows: true });
  await f.suggest("card_title");
  assert.ok(
    f.calls.logs.some((message) => /could NOT be recorded/.test(message)),
    "a comment that cannot be written is named in the log",
  );
});

test("the publish sits in its own try/catch, separate from the delivery write", async () => {
  const f = burstFixture({ publishThrows: true });
  await f.suggest("card_title");
  assert.deepEqual(
    f.calls.written,
    [["card_title", "A generated title"]],
    "a refresh failure is never classified as a delivery failure",
  );
});

test("an unexpected throw still leaves an internal_error record", async () => {
  const f = burstFixture({ presetThrows: true });
  await f.suggest("card_title");
  assert.ok(
    f.calls.comments.some(([, body]) => /internal error/.test(body)),
    "the removed bare catch has no successor that records nothing",
  );
});

test("a timeout retries once, on its own shorter budget, through the same spawn helper", async () => {
  const f = burstFixture({
    completions: [
      { status: "idle", timedOut: true },
      { status: "idle", timedOut: false },
    ],
  });
  await f.suggest("card_title");
  assert.deepEqual(f.calls.waits, [24, 12], "the retry keeps its own, shorter poll budget");
  assert.equal(f.calls.spawns, 2, "the retry reuses the single spawnTitle helper");
  assert.deepEqual(f.calls.written, [["card_title", "A generated title"]], "the retry lands the title");
});

test("an errored thread is never retried — only a timeout is", async () => {
  const f = burstFixture({ completions: [{ status: "failed", timedOut: false }] });
  await f.suggest("card_title");
  assert.deepEqual(f.calls.waits, [24], "one attempt only");
  assert.equal(f.calls.spawns, 1, "an error is not a retryable cause");
  assert.ok(f.calls.comments.some(([, body]) => /ended in error/.test(body)), "and it is recorded");
});

test("the retry counter is released, so a later burst can still retry", async () => {
  for (const cardId of ["card_retry_a", "card_retry_b"]) {
    const f = burstFixture({
      cardId,
      completions: [
        { status: "idle", timedOut: true },
        { status: "idle", timedOut: false },
      ],
    });
    await f.suggest(cardId);
    assert.deepEqual(f.calls.waits, [24, 12], `${cardId} retries without a leaked in-flight counter`);
  }
});

test("the spawn-site count stays at two literal sites; a retry must call spawnTitle", () => {
  const spawnLiterals = (drafting.match(/spawnDisposable\(/g) ?? []).length;
  assert.equal(spawnLiterals, 2, "only the two existing literal sites in drafting.ts");
});

test("the title path is not a silent no-op when output is unusable", () => {
  assert.equal(validateCardName("").ok, false);
  assert.equal(validateCardName("   ").ok, false);
});
