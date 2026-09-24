import assert from "node:assert/strict";
import { relativeTime } from "../lib/relative-time.mjs";

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

console.log("relative time test ok: now, flips, clamps");
