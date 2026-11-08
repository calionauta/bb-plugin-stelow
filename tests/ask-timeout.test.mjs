// Behavior: the configured label is the product surface, and the environment
// override only wins when it is a readable positive number. A typo used to
// become NaN through `Number()`, which stamped recovery rows with a timestamp
// nobody could read; falling back to the configured wait is the whole rule.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ASK_TIMEOUT_OPTIONS,
  DEFAULT_ASK_TIMEOUT,
  DEFAULT_ASK_TIMEOUT_MS,
  resolveAskTimeoutMs,
} from "../lib/ask-timeout.mjs";

const HOUR_MS = 60 * 60 * 1000;

test("the default is the one-hour label in milliseconds", () => {
  assert.equal(DEFAULT_ASK_TIMEOUT, "1 hour", "the shipped default label is 1 hour");
  assert.equal(DEFAULT_ASK_TIMEOUT_MS, 3600000, "the default label resolves to one hour of milliseconds");
  assert.equal(DEFAULT_ASK_TIMEOUT_MS, HOUR_MS, "the constant is derived from the same hour arithmetic");
});

test("every offered label resolves to its own milliseconds", () => {
  for (const [label, expected] of Object.entries(ASK_TIMEOUT_OPTIONS)) {
    assert.equal(
      resolveAskTimeoutMs(label, undefined),
      expected,
      `${label} must resolve to its own value with no override`,
    );
  }
  assert.equal(resolveAskTimeoutMs("7 days", undefined), 604800000, "a week is seven days of milliseconds");
});

test("a finite positive override wins over the configured label", () => {
  assert.equal(resolveAskTimeoutMs("4 hours", "120000"), 120000, "a numeric override replaces the configured wait");
  assert.equal(resolveAskTimeoutMs("4 hours", 90000), 90000, "a numeric value is accepted too, not only a string");
});

test("an unreadable override falls back to the configured label", () => {
  for (const bad of ["not-a-number", "", "   ", "NaN", "Infinity"]) {
    assert.equal(
      resolveAskTimeoutMs("4 hours", bad),
      4 * HOUR_MS,
      `the override ${JSON.stringify(bad)} is not a finite number and must not replace the wait`,
    );
  }
});

test("a non-positive override falls back instead of disabling the wait", () => {
  assert.equal(resolveAskTimeoutMs("4 hours", "0"), 4 * HOUR_MS, "zero would mean no wait at all");
  assert.equal(resolveAskTimeoutMs("4 hours", "-5"), 4 * HOUR_MS, "a negative wait is not a wait");
});

test("an unknown or missing label falls back to the default", () => {
  assert.equal(resolveAskTimeoutMs("bogus", undefined), DEFAULT_ASK_TIMEOUT_MS, "an unlisted label uses the default");
  assert.equal(resolveAskTimeoutMs("bogus", undefined), 3600000, "unknown label => one hour");
  assert.equal(resolveAskTimeoutMs(undefined, undefined), 3600000, "a missing label uses the default");
  assert.equal(
    resolveAskTimeoutMs(undefined, "not-a-number"),
    DEFAULT_ASK_TIMEOUT_MS,
    "a missing label and a bad override together still land on the default, never NaN",
  );
});

console.log("ask timeout test ok: labels, override precedence, and fallbacks pinned");
