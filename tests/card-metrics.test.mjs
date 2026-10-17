import assert from "node:assert/strict";
import { formatDuration, summarizeTimeline, summarizeDurations } from "../lib/card-metrics.mjs";
import { totalScopeElapsedMs } from "../lib/scope-elapsed.mjs";

const HOUR = 3_600_000;

// Lead runs creation to end; cycle runs first movement to end.
const events = [
  { stage: "triage", entered_at: 0 },
  { stage: "execution", entered_at: HOUR },
  { stage: "audit", entered_at: 3 * HOUR },
];
const timeline = summarizeTimeline(events, { createdAt: 0, endAt: 4 * HOUR });
assert.equal(timeline.leadMs, 4 * HOUR, "lead covers creation to end");
assert.equal(timeline.cycleMs, 3 * HOUR, "cycle covers first advance to end");
assert.deepEqual(timeline.byStage, [
  { stage: "triage", ms: HOUR },
  { stage: "execution", ms: 2 * HOUR },
  { stage: "audit", ms: HOUR },
], "per-stage durations split at entries");

// A card that never left its creation stage has no cycle time yet.
const idle = summarizeTimeline([{ stage: "triage", entered_at: 0 }], { createdAt: 0, endAt: HOUR });
assert.equal(idle.cycleMs, null, "no movement means no cycle time");
assert.equal(idle.leadMs, HOUR, "lead still accrues");

// Empty ledgers degrade instead of throwing.
const bare = summarizeTimeline([], { createdAt: 100, endAt: 200 });
assert.equal(bare.leadMs, 100, "missing events fall back to bounds");
assert.equal(bare.cycleMs, null, "missing events mean no cycle");

// Human durations stay compact at every scale.
assert.equal(formatDuration(3 * 86400000 + 4 * HOUR), "3d 4h", "days");
assert.equal(formatDuration(5 * HOUR + 12 * 60000), "5h 12m", "hours");
assert.equal(formatDuration(8 * 60000 + 30000), "8m 30s", "minutes");
assert.equal(formatDuration(45000), "45s", "seconds");

// Board percentiles rank finished durations only; empties and junk
// resolve nulls so an empty board never reports a zero p50.
assert.deepEqual(summarizeDurations([100, 200, 300, 400]), { count: 4, p50: 200, p90: 400, max: 400 }, "p50/p90 rank, max caps");
assert.deepEqual(summarizeDurations([150]), { count: 1, p50: 150, p90: 150, max: 150 }, "a single value is its own percentile");
assert.deepEqual(summarizeDurations([]), { count: 0, p50: null, p90: null, max: null }, "empty sets resolve nulls, never zero");
assert.deepEqual(summarizeDurations([100, -5, NaN, "x"]), { count: 1, p50: 100, p90: 100, max: 100 }, "junk never enters the ranking");
assert.equal(
  totalScopeElapsedMs([{ status: "done", startedAt: "2026-01-01T00:00:00Z", record: { completedAt: "2026-01-01T00:01:00Z" } }]),
  60000,
  "completed scope time is bounded",
);
assert.equal(totalScopeElapsedMs([{ status: "pending" }]), null, "unstarted scope has no elapsed time");

// Behavioral composition: the flow surfaces are a thin projection over these
// lib helpers — lead/cycle from the stage ledger, formatting from the shared
// formatter. Pin the composition the projection must preserve: per-stage
// slices sum to the lead, and the lead formats through the same helper.
assert.equal(
  timeline.byStage.reduce((sum, slice) => sum + slice.ms, 0),
  timeline.leadMs,
  "per-stage slices telescope to the lead",
);
assert.equal(formatDuration(timeline.leadMs), "4h", "the lead formats through the shared helper");
assert.equal(formatDuration(idle.leadMs), "1h", "an idle card still formats its accrued lead");
console.log("card metrics test ok: lead/cycle math, stage split, durations");
