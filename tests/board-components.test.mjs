import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildListMeta,
  exploreListMeta,
  pendingReview,
  researchListMeta,
  showScopeStrip,
} from "../lib/board-list-presentation.mjs";
import { normalizeBoardView, viewsForTrack } from "../lib/board-views.mjs";
import {
  collapsedGroupsFromStorage,
  isInitialPanelLoad,
  mergePanelData,
  panelErrorMessage,
  shouldNotifyPanelError,
} from "../lib/panel-state.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const filters = readFileSync(join(root, "components/board/board-filters.tsx"), "utf8");
const viewToggle = readFileSync(join(root, "components/board/board-view-toggle.tsx"), "utf8");
const lists = readFileSync(join(root, "components/board/track-lists.tsx"), "utf8");
const panelState = readFileSync(join(root, "components/panel/panel-state-hooks.ts"), "utf8");
const inboxPanel = readFileSync(join(root, "components/panels/inbox-panel.tsx"), "utf8");

assert.deepEqual(viewsForTrack("build"), ["board", "list", "hill"], "build keeps its three views");
assert.deepEqual(viewsForTrack("research"), ["board", "list"], "research excludes hill");
assert.deepEqual(viewsForTrack("explore"), ["board", "list"], "explore excludes hill");
assert.equal(normalizeBoardView("hill", "research"), "board", "a stale lightweight hill value cannot strand research");
assert.equal(normalizeBoardView("hill", "explore"), "board", "a stale lightweight hill value cannot strand explore");
assert.equal(normalizeBoardView("list", "research"), "list", "supported lightweight views still persist");
assert.equal(normalizeBoardView("bogus", "build"), "board", "corrupt values degrade to board");
assert.throws(() => viewsForTrack("unknown"), /Unknown board track/, "unknown tracks fail at the view boundary");

assert.match(
  viewToggle,
  /viewsForTrack\(track\)\.includes\(option\.value\)/,
  "the rendered toggle derives its options from the track restriction",
);
assert.match(app, /<ViewToggle[^>]*track="build"/, "build calls the shared toggle as build");
assert.match(app, /<ViewToggle[^>]*track="research"/, "research calls the shared toggle as research");
assert.match(app, /<ViewToggle[^>]*track="explore"/, "explore calls the shared toggle as explore");
assert.equal((app.match(/useBoardView\(STORAGE_KEYS\.\w+View, "\w+"\)/g) ?? []).length, 3, "all three panels bind persistence to a track");
assert.equal((app.match(/<ViewToggle/g) ?? []).length, 3, "one shared toggle call site per board");
assert.match(panelState, /normalizeBoardView\(window\.localStorage\.getItem\(storageKey\), track\)/, "stored views pass through the tested track restriction");
assert.equal(
  (app.match(/= usePanelData/g) ?? []).length
    + (inboxPanel.match(/= usePanelData/g) ?? []).length,
  4,
  "all four data-backed panels use the shared loading lifecycle",
);
assert.equal((app.match(/firstLoadRef/g) ?? []).length, 0, "panel shells no longer own duplicate first-load state");

assert.deepEqual(collapsedGroupsFromStorage(null, false), { archived: true }, "missing column state starts archived");
assert.deepEqual(collapsedGroupsFromStorage('{"inbox":true}', true), { archived: true, inbox: true }, "list groups merge their default under stored choices");
assert.deepEqual(collapsedGroupsFromStorage('{"inbox":true}', false), { inbox: true }, "column state preserves an explicit archive override");
assert.deepEqual(collapsedGroupsFromStorage("not-json", true), { archived: true }, "corrupt state recovers at the default");
assert.equal(isInitialPanelLoad(true, 0), true, "an empty first load shows the panel skeleton");
assert.equal(isInitialPanelLoad(true, 2), false, "a background refresh keeps existing content visible");
assert.equal(panelErrorMessage(new Error("rpc failed"), "fallback"), "rpc failed", "panel failures preserve the RPC message");
assert.equal(panelErrorMessage("not-an-error", "fallback"), "fallback", "panel failures use the panel fallback for non-errors");
assert.equal(shouldNotifyPanelError(false, "Unable to load Stelow Inbox."), false, "Inbox failures do not add a toast");
assert.equal(shouldNotifyPanelError(true, "Unable to load Stelow."), true, "board failures keep their existing toast");
assert.deepEqual(
  mergePanelData(
    { cards: [{ id: "card-1" }], githubAutomationEnabled: false },
    { cards: [] },
  ),
  { cards: [], githubAutomationEnabled: false },
  "a partial board refresh keeps integration state when that RPC is unavailable",
);
assert.match(
  inboxPanel,
  /usePanelData\(loadInbox, \{[\s\S]*?notifyOnError: false[\s\S]*?itemCountKey: "notifications"/,
  "Inbox load failures stay in the retry panel instead of adding a toast",
);
assert.equal((app.match(/function InboxPanel\(/g) ?? []).length, 0, "the Inbox panel no longer lives in the app shell");

const scopeSummary = { scopesDone: 2, scopesTotal: 5, tasksDone: 3, tasksTotal: 7 };
assert.equal(
  buildListMeta({ status: "completed", stage: "build", scopeSummary }),
  "Completed · ✓ 2/5 scopes · 3/7 tasks",
  "completed build rows retain status and progress context",
);
assert.equal(
  buildListMeta({ status: "in-progress", stage: "plan", scopeSummary: { ...scopeSummary, scopesTotal: 0 } }),
  "plan",
  "scopeless build rows do not print empty progress",
);
assert.equal(
  researchListMeta({ researchStrategies: ["jtbd", "unknown"] }, new Map([["jtbd", "Jobs to Be Done"]])),
  "Jobs to Be Done + unknown",
  "research rows preserve known and fallback strategy labels",
);
assert.equal(researchListMeta({}, new Map()), null, "research rows without strategies omit the meta fragment");
assert.equal(pendingReview({ status: "completed", hasPendingReview: true }), true, "an unopened completion asks for review");
assert.equal(
  pendingReview({ status: "in-progress", hasPendingReview: true }),
  false,
  "a stale review signal cannot label unfinished work for review",
);
assert.equal(
  showScopeStrip({ kind: "build", scopeSummary }),
  true,
  "build list rows retain their scope progress strip",
);
assert.equal(
  showScopeStrip({ kind: "research", scopeSummary }),
  false,
  "research list rows do not gain build-only scope progress",
);
assert.equal(
  showScopeStrip({ kind: "explore", scopeSummary }),
  false,
  "explore list rows do not gain build-only scope progress",
);
assert.equal(
  showScopeStrip({ kind: "build", scopeSummary: { ...scopeSummary, scopesTotal: 0 } }),
  false,
  "scopeless build rows do not render an empty progress strip",
);
assert.equal(
  exploreListMeta({ exploreStage: "proto" }, new Map([["proto", "Prototype"]])),
  "Prototype",
  "explore rows resolve the selected technique",
);
assert.equal(exploreListMeta({ exploreStage: "unknown" }, new Map()), "unknown", "unknown explore stages fall back to their id");
assert.equal(exploreListMeta({}, new Map()), null, "explore rows without a technique omit the meta fragment");

for (const adapter of ["BuildList", "ResearchList", "ExploreList"]) {
  assert.match(lists, new RegExp(`export function ${adapter}\\(`), `${adapter} is extracted to the board component`);
}
assert.match(lists, /export function BuildList[\s\S]*buildListMeta\(card\)/, "build list uses the tested build metadata adapter");
assert.match(lists, /export function ResearchList[\s\S]*researchListMeta\(card, strategyLabelById\)/, "research list uses strategy metadata");
assert.match(lists, /export function ExploreList[\s\S]*exploreListMeta\(card, stageLabelById\)/, "explore list uses technique metadata");
assert.match(lists, /showScopeStrip\(card\)/, "shared rows apply the tested track-specific progress rule");
assert.match(lists, /pendingReview\(card\) \? <ReviewChip/, "shared rows apply the tested completion-review rule");
assert.equal((app.match(/function (?:BuildList|ResearchList|ExploreList)\(/g) ?? []).length, 0, "list adapters no longer live in the app shell");

assert.match(filters, /function optionalFacet\([\s\S]*!options \|\| !values \|\| !onToggle/, "a facet appears only when its complete contract exists");
assert.match(filters, /event\.key === "Escape"/, "Escape dismisses the filter popover");
assert.match(filters, /document\.addEventListener\("pointerdown"/, "outside pointer input dismisses the popover");
assert.match(filters, /type="checkbox"/, "multi-select filters use keyboard-native checkboxes");
assert.match(filters, /aria-label={`Remove \$\{facet\.label\} filter \$\{label\}`}/, "selected filter pills expose their facet and value");
assert.equal((app.match(/<FiltersBar/g) ?? []).length, 3, "all boards use the extracted filter bar");
assert.equal((app.match(/function FiltersBar\(/g) ?? []).length, 0, "the filter bar no longer lives in the app shell");

console.log("board components test ok: view restrictions, metadata, and shared controls");
