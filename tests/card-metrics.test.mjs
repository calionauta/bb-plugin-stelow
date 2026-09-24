import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDuration, summarizeTimeline, summarizeDurations } from "../lib/card-metrics.mjs";

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

// Server wiring: one batched flow RPC (finished cards only, project +
// done-window filters, p50/p90 summary) plus per-card times on detail.
// Active cards carry no times — the query scopes completed, the detail
// degrades to nulls.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const flowStrip = readFileSync(join(root, "components", "board", "flow-strip.tsx"), "utf8");
const panelState = readFileSync(join(root, "components", "panel", "panel-state-hooks.ts"), "utf8");
const buildProgress = readFileSync(join(root, "components", "detail", "build-progress.tsx"), "utf8");
const workerHistory = readFileSync(join(root, "components", "worker-history", "worker-history.tsx"), "utf8");
assert.match(server, /flowMetrics: \{/, "the flow RPC is contracted");
assert.match(server, /WHERE status = 'completed'/, "aggregates read finished cards, never actives");
assert.match(server, /GROUP BY card_id/, "one batched pass per dimension, no per-card round trips");
assert.match(server, /since != null && doneAt < since/, "the done window filters both ends");
assert.match(server, /leadMs: flowTimesForCard\(card\)\.leadMs, cycleMs: flowTimesForCard\(card\)\.cycleMs/, "detail reuses the one helper, never its own math");
assert.match(server, /leadMs: z\.number\(\)\.nullable\(\), cycleMs: z\.number\(\)\.nullable\(\), doingNow: z\.array\(z\.string\(\)\), verifiedHeadSha: z\.string\(\)\.nullable\(\) \}\),/, "detail schema carries times, doing names, and the verified HEAD as nullable");
assert.match(buildProgress, /const flow = \{ leadMs: detail\.card\.leadMs \?\? null, cycleMs: detail\.card\.cycleMs \?\? null \}/, "detail progress reads the card times");
assert.match(buildProgress, /<ScopeProgress scopes=\{detail\.scopes\} flow=\{flow\} \/>/, "the scoped progress view receives the card flow");
assert.match(buildProgress, /Lead \{flow\.leadMs !== null \? formatDuration\(flow\.leadMs\) : "—"\}/, "missing times render a dash, never a zero");

// View persistence: returning from a card restores the picked view per
// track (board, list, hill) instead of resetting to board. Unknown stored
// values degrade — a corrupt key never strands the track.
assert.match(app, /buildView: "stelow-build-view-v1"/, "each track owns its view key");
assert.match(panelState, /export function useBoardView\(/, "one extracted hook serves all three tracks with view restrictions");
assert.match(app, /useBoardView\(STORAGE_KEYS\.buildView, "build"\)/, "build restores its view");
assert.match(app, /useBoardView\(STORAGE_KEYS\.researchView, "research"\)/, "research restores its view");
assert.match(app, /useBoardView\(STORAGE_KEYS\.exploreView, "explore"\)/, "explore restores its view");

// Flow strip: one glanceable line on finished work (count + p50s),
// expanding to window presets and a per-card table. Empty boards render
// nothing — clean stays clean. Project comes from the board filter, so
// no second picker drifts out of sync with it.
assert.match(flowStrip, /export function FlowStrip\(\{ rpc, projectId, onOpenCard \}/, "one strip component owns board flow");
const flowMount = app.match(/<FlowStrip[\s\S]*?\/>/)?.[0] ?? "";
assert.ok(
  flowMount.includes(
    "projectId={filterProjectIds.length === 1 ? filterProjectIds[0] ?? null : null}",
  ),
  "the strip follows one picked project, or all projects",
);
assert.ok(
  flowMount.includes(
    "onOpenCard={(kind, cardId) => goToCard(navigate, { kind }, cardId)}",
  ),
  "every flow row forwards through the shared navigator",
);
assert.match(flowStrip, /if \(!result \|\| result\.summary\.count === 0\) return null/, "no finished cards means no strip");
assert.match(flowStrip, /FLOW_WINDOWS/, "done windows are presets, not free dates");
assert.match(flowStrip, /onOpenCard\(item\.kind, item\.cardId\)/, "flow rows open through the shared navigator");

// Attention rides the same RPC pass: stuck (blocked status or errored
// worker — explicit signals, never heuristics) and review-awaiting dones,
// window-independent and labeled as right-now. Tabs keep tempo apart
// from attention; empty attention reads one calm line, never an empty box.
assert.match(server, /attention: z\.array\(z\.object\(\{ cardId: z\.string\(\), kind: z\.enum\(\["build", "research", "explore"\]\), name: z\.string\(\), reason: z\.enum\(\["stuck", "review"\]\) \}\)\)/, "attention items are contracted with a closed reason set");
assert.match(server, /row\.status === "blocked" \|\| row\.activity === "error"/, "stuck derives from explicit signals only");
assert.match(server, /hasPendingReview\(db, row\.id\)/, "review-awaiting derives from the shared review signal");
assert.match(flowStrip, /type FlowTab = "tempo" \| "atencao"/, "tempo and attention share one closed tab type");
assert.match(flowStrip, /useState<FlowTab>\("tempo"\)/, "tempo is the default tab, not a second stacked section");
assert.match(flowStrip, /Right now — not in the selected window/, "attention names its window-independence where it could confuse");
assert.match(
  flowStrip,
  /isStuck \? "animate-pulse bg-amber-500" : "bg-emerald-500"/,
  "only the stuck indicator pulses; the review indicator stays still",
);
assert.match(flowStrip, /All clear — nothing stuck, nothing awaiting review/, "empty attention reassures instead of blanking");
assert.doesNotMatch(flowStrip, /velocity|throughput per|per worker/, "no efficiency ranking survives in the strip");

// The header names the component and its count honestly: Flow indicators
// over finished cards with a measured trail — never a bare "N done" that
// reads as Done-column membership. p50/p90 never stand unexplained.
assert.match(flowStrip, />Flow<\//, "the strip header names the component, not just its numbers");
assert.match(flowStrip, /Finished cards with a measured trail/, "the count explains its own scope in label and title");
assert.match(
  flowStrip,
  /\{result\.summary\.count\} finished · \{preset\.label\.toLowerCase\(\)\}/,
  "the closed header names its window — a filtered count never reads as the column",
);
assert.match(flowStrip, /Typical is the median \(p50\)/, "typical is glossed, not assumed");
assert.match(flowStrip, /9 of 10 finish within/, "slow names what p90 means in words");
assert.match(flowStrip, /Lead[\s\S]*cycle runs first real movement/, "lead vs cycle reads inline, not only on hover");
assert.doesNotMatch(flowStrip, /lead p50 \{/, "no bare p50 readout survives in the header");
assert.doesNotMatch(flowStrip, /p90 lead \{/, "no bare p90 readout survives in the window row");

// Worker-history total: one summed line in the summary, unknowns skipped,
// all-unknown hidden — the per-thread rows below keep their own numbers.
assert.match(workerHistory, /totalTokenUsage\(history\)/, "the summary totals through the lib, never inline math");
assert.match(workerHistory, /<WorkerHistoryRow key=\{entry\.threadId\} entry=\{entry\} \/>/, "the list delegates one row per entry");
assert.match(workerHistory, /entry\.endedAt === null \? "Current worker"/, "a live worker reads current, a replaced one names its end");
assert.match(workerHistory, /tokens total<\/span>/, "the total reads as a total, not another row");

console.log("card metrics test ok: lead/cycle math, stage split, durations");
