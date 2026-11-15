import assert from "node:assert/strict";
import { elapsedUnits, relativeTime } from "../lib/relative-time.mjs";

const now = Date.now();
// Sub-minute reads now, whatever the clock says — future clamps, never lies.
assert.equal(relativeTime(now), "Just now", "now reads now");
assert.equal(relativeTime(now - 30 * 1000), "Just now", "seconds read now");
assert.equal(relativeTime(now + 60_000), "Just now", "future clamps to now");
// Exact unit flips: 60s -> minutes, 60m -> hours, 24h -> days.
assert.equal(relativeTime(now - 60 * 1000), "1m ago", "a minute reads minutes");
assert.equal(relativeTime(now - 59 * 60 * 1000), "59m ago", "minutes hold below the hour");
assert.equal(relativeTime(now - 60 * 60 * 1000), "1h ago", "an hour reads hours");
assert.equal(relativeTime(now - 23 * 3600 * 1000), "23h ago", "hours hold below the day");
assert.equal(relativeTime(now - 24 * 3600 * 1000), "Yesterday", "a day reads yesterday");
assert.equal(relativeTime(now - 3 * 24 * 3600 * 1000), "3d ago", "days read days");

// The duration scale: same flips, floor instead of round, never a unit that
// overstates the wait. This is the one the review queue's age cell speaks.
assert.equal(elapsedUnits(now, now), "0m", "no wait reads zero minutes");
assert.equal(elapsedUnits(now - 45 * 60 * 1000, now), "45m", "sub-hour reads minutes");
assert.equal(elapsedUnits(now - 4 * 3600 * 1000, now), "4h", "a four-hour wait is hours, not 0d");
assert.equal(elapsedUnits(now - 23.6 * 3600 * 1000, now), "23h", "floors: 23.6h is not yet a day");
assert.equal(elapsedUnits(now - 24 * 3600 * 1000, now), "1d", "a day reads days");
assert.equal(elapsedUnits(now - 3 * 24 * 3600 * 1000, now), "3d", "days read days");
assert.equal(elapsedUnits(now + 60_000, now), "0m", "a future timestamp clamps, never a negative wait");

console.log("relative time test ok: now, flips, clamps, duration floor");
