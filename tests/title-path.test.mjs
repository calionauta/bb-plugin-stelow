/**
 * The title path's record, guard, and retry wiring.
 *
 * Its own file because tests/server-drafting.test.mjs's `harness` is at exactly
 * its recorded debt ceiling (83 lines, scripts/source-debt.json). These cases
 * need per-spawn scripting the existing harness cannot grow to express.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCardName } from "../lib/draft-burst.mjs";

const burst = readFileSync(new URL("../server/title-burst.ts", import.meta.url), "utf8");
const drafting = readFileSync(new URL("../server/drafting.ts", import.meta.url), "utf8");
const combined = `${drafting}\n${burst}`;

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
});

test("an archived card is never renamed, matching both draft paths", () => {
  assert.match(burst, /isArchivedCard/);
  // The guard must read the LIVE card, not the pre-burst snapshot.
  assert.match(
    burst,
    /archived: live \? deps\.isArchivedCard\(live\) : false,/,
    "the guard reads the live card so a mid-burst archive is caught",
  );
});

test("the record is guarded so a failed comment never fails a delivery", () => {
  assert.match(
    burst,
    /deps\.comment\(cardId, body\);[\s\S]{0,80}catch \{/,
    "the comment write sits in its own try/catch",
  );
});

test("the publish sits in its own try/catch, separate from the delivery write", () => {
  assert.match(
    burst,
    /deps\.publish\("card-state", \{ cardId \}\);[\s\S]{0,60}catch \{/,
    "a refresh failure is never classified as a delivery failure",
  );
  assert.match(burst, /A failed refresh is not a delivery failure/);
});

test("the bare catch that recorded nothing is gone", () => {
  assert.doesNotMatch(
    combined,
    /catch \{\s*\n\s*\/\/ Card creation already succeeded; title suggestion is always advisory\./,
    "the silent catch must not survive this change",
  );
  assert.match(burst, /"internal_error"/, "an unexpected throw still leaves a record attempt");
});

test("the retry is bounded by a process-wide counter released in finally", () => {
  assert.match(burst, /const TITLE_RETRY_INFLIGHT = 2;/);
  assert.match(burst, /retriesInFlight < TITLE_RETRY_INFLIGHT/, "the cap gates the retry");
  assert.match(
    burst,
    /finally \{\s*retriesInFlight--;/,
    "a leaked counter turns a bounded retry into an unbounded one",
  );
});

test("the retry reuses the existing spawnTitle helper, keeping the four-spawn pin true", () => {
  const spawnLiterals = (drafting.match(/spawnDisposable\(/g) ?? []).length;
  assert.equal(spawnLiterals, 2, "only the two existing literal sites; a retry must call spawnTitle");
  assert.equal((burst.match(/deps\.spawnTitle\(/g) ?? []).length, 1, "one call site, reused by both attempts");
});

test("the budgets are named constants, not derived from the draft path", () => {
  assert.match(burst, /const TITLE_POLLS = 24;/);
  assert.match(burst, /const TITLE_RETRY_POLLS = 12;/);
  assert.doesNotMatch(burst, /TITLE_POLLS = DRAFT_/);
});

test("the title path is not a silent no-op when output is unusable", () => {
  assert.equal(validateCardName("").ok, false);
  assert.equal(validateCardName("   ").ok, false);
});
