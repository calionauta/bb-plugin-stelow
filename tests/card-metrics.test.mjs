import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

// Server wiring: one batched flow RPC (finished cards only, project +
// done-window filters, p50/p90 summary) plus per-card times on detail.
// Active cards carry no times — the query scopes completed, the detail
// degrades to nulls.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server.ts"), "utf8"),
  readFileSync(join(root, "server", "plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-detail-presentation.ts"), "utf8"),
  readFileSync(join(root, "server", "card-rpc-contract.ts"), "utf8"),
  readFileSync(join(root, "server", "card-detail-rpc-contract.ts"), "utf8"),
  readFileSync(join(root, "server", "cards.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "wiring", "rpc-surfaces.ts"), "utf8"),
].join("\n");
const executionContract = readFileSync(join(root, "server", "execution-contract.ts"), "utf8");
const buildPanelState = readFileSync(join(root, "components", "panels", "build-panel-state.ts"), "utf8");
const researchPanelState = readFileSync(join(root, "components", "panels", "research-panel-state.ts"), "utf8");
const explorePanelState = readFileSync(join(root, "components", "panels", "explore-panel-state.ts"), "utf8");
const buildPanelView = readFileSync(join(root, "components", "panels", "build-panel-view.tsx"), "utf8");
const storage = readFileSync(join(root, "lib", "panel-storage.mjs"), "utf8");
const flowStrip = readFileSync(join(root, "components", "board", "flow-strip.tsx"), "utf8");
const buildProgress = readFileSync(join(root, "components", "detail", "build-progress.tsx"), "utf8");
const workerHistory = readFileSync(join(root, "components", "worker-history", "worker-history.tsx"), "utf8");
assert.match(server, /flowMetrics: \{/, "the flow RPC is contracted");
assert.match(server, /flowMetrics: \(input: FlowMetricsInput\) =>\s*\n?\s*buildFlowMetrics\(/, "RPC dispatch uses the measured flow runtime");
// The handler enriches the pure ledger summary with the coverage readings, and
// the coverage read is fail-soft. The dispatch must therefore go through the
// module-scope builder rather than calling the pure function inline, which is
// what the two-line form above asserts.
assert.match(server, /async function buildFlowMetrics\(/, "the flow handler owns the coverage seam, not the pure ledger summary");
assert.match(server, /\.catch\(\(\) => EMPTY_COVERAGE\)/, "a workspace the strip cannot read costs it a line, not the whole panel");
assert.match(server, /leadMs: flow\.leadMs/, "detail reuses the one helper for lead time");
assert.match(server, /cycleMs: flow\.cycleMs/, "detail reuses the one helper for cycle time");
const detailTimesContract = /leadMs:[\s\S]*?cycleMs:[\s\S]*?doingNow:[\s\S]*?verifiedHeadSha: z\s*\.string\(\)\s*\.nullable\(\)/;
assert.match(server, detailTimesContract, "detail schema carries times, doing names, and the verified HEAD as nullable");
assert.match(server, /executionRuns: deps\.executionLifecycle\.detailList\(card\.id\)/, "card detail uses the public execution-run projection");
assert.doesNotMatch(server, /executionRuns: executionLifecycle\.list\(cardId\)/, "card detail never exposes raw ledger rows");
assert.match(executionContract, /executionRuns: \{/, "execution runs remain available through their dedicated RPC");
assert.match(buildProgress, /const flow = \{ leadMs: detail\.card\.leadMs \?\? null, cycleMs: detail\.card\.cycleMs \?\? null \}/, "detail progress reads the card times");
assert.match(buildProgress, /<ScopeProgress scopes=\{detail\.scopes\} flow=\{flow\} \/>/, "the scoped progress view receives the card flow");
assert.match(buildProgress, /Lead \{flow\.leadMs !== null \? formatDuration\(flow\.leadMs\) : "—"\}/, "missing times render a dash, never a zero");

// View persistence: returning from a card restores the picked view per
// track (board, list, hill) instead of resetting to board. Unknown stored
// values degrade — a corrupt key never strands the track.
assert.match(storage, /buildView: "stelow-build-view-v1"/, "each track owns its view key");
assert.match(buildPanelState, /useBoardView\(STORAGE_KEYS\.buildView, "build"\)/, "build restores its view");
assert.match(researchPanelState, /useBoardView\(STORAGE_KEYS\.researchView, "research"\)/, "research restores its view");
assert.match(
  researchPanelState,
  /usePersistentCollapsedGroups\([\s\S]*STORAGE_KEYS\.researchColumns/,
  "research board columns restore their own collapsed state",
);
assert.match(
  researchPanelState,
  /useCollapsedGroups\([\s\S]*STORAGE_KEYS\.researchListGroups/,
  "research list groups restore their own collapsed state",
);
assert.match(explorePanelState, /useBoardView\(STORAGE_KEYS\.exploreView, "explore"\)/, "explore restores its view");

// Flow strip: one glanceable line on finished work (count + p50s),
// expanding to window presets and a per-card table. Empty boards render
// nothing — clean stays clean. Project comes from the board filter, so
// no second picker drifts out of sync with it.
assert.match(flowStrip, /export function FlowStrip\(\{ rpc, projectId, onOpenCard \}/, "one strip component owns board flow");
const flowMount = buildPanelView.match(/<FlowStrip[\s\S]*?\/>/)?.[0] ?? "";
assert.ok(
  flowMount.includes(
    "projectId={state.projectIds.length === 1 ? state.projectIds[0] ?? null : null}",
  ),
  "the strip follows one picked project, or all projects",
);
assert.ok(
  flowMount.includes(
    "onOpenCard={(kind, cardId) => props.onOpenCard({ kind }, cardId)}",
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
const attentionContract = /attention: z\s*\.array\([\s\S]*?reason: z\s*\.enum\(\["stuck",\s*"review"\]\)/;
assert.match(server, attentionContract, "attention items are contracted with a closed reason set");
assert.match(flowStrip, /type FlowTab = "timing" \| "attention"/, "timing and attention share one closed tab type");
assert.match(flowStrip, /useState<FlowTab>\("timing"\)/, "timing is the default tab, not a second stacked section");
assert.match(flowStrip, /entry === "timing"\s*\n\s*\? "Timing"/, "tab labels are English, matching the rest of the card UI");
assert.doesNotMatch(flowStrip, /Tempo|Atenção/, "no non-English UI copy survives in the strip");
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
// The total's own claim, which now depends on what it summed. The old shape pinned
// `<span>… tokens total</span>`, and that assertion was already softened once for
// wrapping; it goes red now for the better reason that the line gained a provenance
// badge. Pinning the LABEL that varies with provenance, rather than the closing tag,
// checks the claim instead of the markup.
assert.match(
  workerHistory,
  /tokens total/,
  "the total reads as a total, not another row",
);
assert.match(
  workerHistory,
  /totalUsageProvenance\(history\)/,
  "the summary asks the lib what kind of figure it summed, so it cannot label estimates as reported",
);
assert.match(
  workerHistory,
  /provenance === "provider" \? null :/,
  "a figure whose provenance is anything but reported carries the (est.) badge, so the always-visible line never overstates",
);

console.log("card metrics test ok: lead/cycle math, stage split, durations");
