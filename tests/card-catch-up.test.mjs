import assert from "node:assert/strict";
import test from "node:test";
import {
  CATCH_UP_KINDS,
  catchUpAnchor,
  catchUpFacts,
  catchUpSummary,
} from "../lib/card-catch-up.mjs";

/**
 * Catch up answers one question — "what changed on this card since I last
 * looked" — and it answers it from rows that already exist. The guards here are
 * for the three ways it stops being honest: an anchor that guesses where the
 * reader stopped, a delta that repeats what they already saw, and a model
 * creeping in to phrase facts it does not have.
 */

test("the anchor is the newest recorded read, and says when there is none", () => {
  assert.deepEqual(
    catchUpAnchor({ readAts: [100, 400, 200], createdAt: 10 }),
    { since: 400, basis: "last-read" },
    "the newest read is the anchor",
  );
  assert.deepEqual(
    catchUpAnchor({ readAts: [], createdAt: 10 }),
    { since: 10, basis: "created" },
    "never read means everything since creation, not 'caught up'",
  );
  assert.deepEqual(
    catchUpAnchor({ readAts: [null, "x", NaN], createdAt: 10 }),
    { since: 10, basis: "created" },
    "junk read stamps are not reads",
  );
  assert.deepEqual(catchUpAnchor({}), { since: 0, basis: "created" }, "no timestamps at all degrades, never throws");
});

test("the list is a delta: everything at or before the anchor is dropped", () => {
  const facts = catchUpFacts({
    since: 100,
    stageEvents: [
      { stage: "triage", entered_at: 100 },
      { stage: "execution", entered_at: 150 },
      { stage: "audit", entered_at: 200 },
    ],
    inboxEvents: [
      { kind: "question", occurred_at: 120, summary: "which one?", resolved_at: null },
    ],
  });
  assert.deepEqual(
    facts.map((fact) => fact.kind),
    ["question", "stage", "stage"],
    "only the delta, in the order it happened",
  );
  assert.deepEqual(
    facts.map((fact) => fact.at),
    [120, 150, 200],
    "sorted oldest-first so the report reads as a sequence",
  );
  assert.equal(facts[0].open, true, "an unanswered question is still open");
});

test("a resolved question reads as an answer, not as a question", () => {
  const [fact] = catchUpFacts({
    since: 0,
    inboxEvents: [{ kind: "question", occurred_at: 50, summary: "which one?", resolved_at: 80 }],
  });
  assert.equal(fact.kind, "answer", "the same row is a different fact once it is answered");
  assert.equal(fact.open, false, "and it is no longer waiting on anyone");
});

test("stalls, failures and completions keep their own kinds and open state", () => {
  const facts = catchUpFacts({
    since: 0,
    inboxEvents: [
      { kind: "paused", occurred_at: 10, summary: "idle", resolved_at: null },
      { kind: "error", occurred_at: 20, summary: "boom", resolved_at: 25 },
      { kind: "completed", occurred_at: 30, summary: "done", resolved_at: null },
      { kind: "mystery", occurred_at: 40, summary: "?", resolved_at: null },
    ],
  });
  assert.deepEqual(
    facts.map((fact) => [fact.kind, fact.open]),
    [["blocked", true], ["error", false], ["completed", true]],
    "each inbox kind maps to its own fact; an unknown kind is not invented into one",
  );
  for (const fact of facts) assert.ok(CATCH_UP_KINDS.includes(fact.kind), "every fact kind is declared");
});

test("artifacts are not a fact kind, because the manifest carries no time", async () => {
  // The manifest records a path and a stage and never a registration stamp, so
  // "this artifact is new since you looked" cannot be derived from it. The
  // module refuses the fact rather than guessing a timestamp for it.
  assert.ok(!CATCH_UP_KINDS.includes("artifact"), "artifact is not a declared fact kind");
  const facts = catchUpFacts({
    since: 0,
    artifacts: [{ name: "spec-tech.md", registeredAt: 180 }],
  });
  assert.deepEqual(facts, [], "an artifact row produces no fact, however it is shaped");
});

test("an empty delta says nothing changed — that IS the answer", () => {
  const facts = catchUpFacts({ since: 500, stageEvents: [{ stage: "audit", entered_at: 100 }] });
  assert.deepEqual(facts, [], "nothing after the anchor means nothing to report");
  assert.equal(
    catchUpSummary(facts, { basis: "last-read" }),
    "Nothing changed since you last looked.",
    "an empty list is reported, not hidden",
  );
  assert.match(
    catchUpSummary([{ kind: "question", at: 1, open: true }], { basis: "created" }),
    /^1 change since this card was created\. 1 still waiting on you\.$/,
    "the summary names the size of the delta and what is actionable",
  );
  assert.match(
    catchUpSummary([{ kind: "stage", at: 1 }, { kind: "stage", at: 2 }], { basis: "last-read" }),
    /^2 changes since you last looked\.$/,
    "plural, and no waiting clause when nothing is open",
  );
});

test("the module is deterministic: same rows, same list, and no model in it", async () => {
  const input = {
    since: 0,
    stageEvents: [{ stage: "execution", entered_at: 5 }],
    inboxEvents: [{ kind: "question", occurred_at: 5, summary: "q", resolved_at: null }],
  };
  assert.deepEqual(catchUpFacts(input), catchUpFacts(input), "same input, same output — no clock, no randomness");
  const source = await import("node:fs").then((fs) => fs.readFileSync(
    new URL("../lib/card-catch-up.mjs", import.meta.url),
    "utf8",
  ));
  assert.doesNotMatch(source, /Date\.now|Math\.random/, "a fact list that depends on the clock is not reproducible");
  // Code shapes, not words: the docstring says a model may PHRASE this list, and
  // a guard on the word would forbid saying so. What must not exist here is a
  // spawn, an import of the host, or anything that could add a fact.
  assert.doesNotMatch(source, /spawnDisposable\(|threads\.spawn\(|@get-bb\/plugin-sdk/, "no spawn belongs in the deterministic half of catch up");
  assert.doesNotMatch(source, /^import /m, "the module imports nothing — its facts are all arguments");
});

console.log("card catch-up test ok: read anchor, delta, kind mapping, honest empty, determinism");
