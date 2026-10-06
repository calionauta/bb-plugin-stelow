import assert from "node:assert/strict";
import { isRateLimitFailure, rateLimitAdvice, retryWindowFromError } from "../lib/rate-limit-refusal.mjs";
import { isOwnershipRefusal } from "../lib/ownership-refusal.mjs";

/**
 * A provider rate limit must not be advised as if answering would fix it.
 *
 * The failure, reported from the live board on two cards a probe run had just created:
 *
 *   Server requested 20174s retry delay (max: 90s). 429 Rate limit exceeded. Please try
 *   again later.
 *
 * The plugin handled it correctly on the way in — not retryable, so the card went to
 * `activity=error` with an inbox event and a trail comment rather than being respawned
 * into the same limit. What it got wrong was the advice: the hero note closed with
 * "Answering below resumes the worker", which is false here. Nothing is pending, the
 * provider is refusing for hours, and the reader is pointed at a box whose answer goes
 * nowhere. `isOwnershipRefusal` was written for the same defect one cause over; this file
 * pins the second cause.
 *
 * The distinction that matters: a rate limit is matched on the provider's STATUS CODE,
 * never on the word "limit" — a card's own exploration limit and a file-claim limit both
 * contain it, and sending a reader to switch providers for one of those is the wrong door.
 */

const REAL = "Server requested 20174s retry delay (max: 90s). 429 Rate limit exceeded. Please try again later.";

// --- 1. The real error is recognised, and its window is read. ---------------
assert.equal(isRateLimitFailure(REAL), true, "the reported error is a rate limit");
assert.deepEqual(
  retryWindowFromError(REAL),
  { seconds: 20174, hours: 20174 / 3600 },
  "the window the provider asked for is read, so the advice can name it",
);
assert.equal(isRateLimitFailure("HTTP 429"), true, "the status code alone is enough");
assert.equal(isRateLimitFailure("Rate limit exceeded. Please try again later."), true, "and the phrase alone is enough");
assert.equal(isRateLimitFailure(""), false, "an empty message is not a rate limit");
assert.equal(isRateLimitFailure(null), false, "and neither is a missing one");
assert.equal(isRateLimitFailure(undefined), false, "nor undefined, which is what a card with no error carries");

// --- 2. The word "limit" alone must never trigger it. ----------------------
// The trap this avoids: a card's own limits are not provider limits, and the advice for
// a provider limit (switch provider, wait hours) is actively wrong for them.
for (const notRateLimit of [
  "explorationCount limit reached for this card",
  "File claim limit exceeded: 3 scopes hold this path",
  "the recipe produced no task outputs",
  "Workflow state ownership cannot be verified: this card's state records disagree",
  "the host is not answering — no card action fixes this",
]) {
  assert.equal(isRateLimitFailure(notRateLimit), false, `not a rate limit: ${notRateLimit.slice(0, 40)}`);
  assert.equal(rateLimitAdvice(notRateLimit), null, "and it gets no rate-limit advice, so the caller falls through");
}

// --- 3. The two refusal causes stay distinct. ------------------------------
// Both are "the generic advice is wrong" cases, and confusing them would send a reader to
// the wrong door: an unowned card needs a reseed, a rate-limited card needs a different
// provider or time.
assert.equal(isOwnershipRefusal(REAL), false, "a rate limit is not an ownership refusal");
assert.equal(isRateLimitFailure("Workflow state ownership cannot be verified"), false, "and an ownership refusal is not a rate limit");

// --- 4. The advice names a door, and never advises an immediate retry. -----
const advice = rateLimitAdvice(REAL);
assert.ok(advice, "a rate limit gets advice");
assert.match(advice, /not a broken worker/, "it says what this is not, because the reader's first assumption is a broken worker");
assert.match(advice, /nothing on the card is waiting for an answer/, "it refuses the generic advice explicitly, which is the defect being fixed");
assert.match(advice, /Switch this card's provider or model/, "it names the action that actually clears it");
assert.match(advice, /Retry worker/, "and the second door, so a reader who prefers waiting has one");
assert.match(advice, /about 6 hours/, "it names the wait in hours rather than repeating a raw second count");
assert.match(
  advice,
  /Retrying now re-hits the same limit/,
  "and it warns against the immediate retry, which otherwise teaches a reader that Retry is the cheap thing to try twice",
);
assert.ok(
  !/Answering below resumes/.test(advice),
  "the false sentence must be gone from this cause entirely",
);

// --- 5. A window in minutes reads in minutes. ------------------------------
const short = rateLimitAdvice("429 Rate limit exceeded. Server requested 300s retry delay.");
assert.match(short, /about 5 minutes/, "a short window is not rounded to zero hours");
assert.ok(!/about 0 hours/.test(short), "and never reads as a zero-hour wait");

// --- 6. A window that cannot be read still gets advice, without a number. --
const noWindow = rateLimitAdvice("429 Rate limit exceeded. Please try again later.");
assert.ok(noWindow, "a rate limit with no stated window still gets advice");
assert.match(noWindow, /wait a while/, "and says so without inventing a duration");
assert.ok(!/\d+ hours/.test(noWindow), "no invented figure reaches the reader");
assert.equal(retryWindowFromError("429 Rate limit exceeded."), null, "and the reader reports no window rather than zero");

// --- 7. Malformed windows are refused, not trusted. ------------------------
for (const bad of [
  "Server requested 0s retry delay. 429 Rate limit exceeded.",
  "Server requested -5s retry delay. 429 Rate limit exceeded.",
  "Server requested abcs retry delay. 429 Rate limit exceeded.",
]) {
  assert.equal(retryWindowFromError(bad), null, `an unusable window is null: ${bad.slice(0, 40)}`);
  assert.match(rateLimitAdvice(bad), /wait a while/, "and the advice degrades to a phrase rather than a wrong number");
}

console.log(
  "rate-limit refusal ok: the cause is recognised by status code, the window is read or refused, "
    + "and the advice names a door instead of the answer box",
);
