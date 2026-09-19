import assert from "node:assert/strict";
import { formatDuration, summarizeTimeline } from "../lib/card-metrics.mjs";

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

console.log("card metrics test ok: lead/cycle math, stage split, durations");
