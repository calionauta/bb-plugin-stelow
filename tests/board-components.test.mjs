import assert from "node:assert/strict";
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

assert.deepEqual(viewsForTrack("build"), ["board", "list", "hill"], "build keeps its three views");
assert.deepEqual(viewsForTrack("research"), ["board", "list"], "research excludes hill");
assert.deepEqual(viewsForTrack("explore"), ["board", "list"], "explore excludes hill");
assert.equal(normalizeBoardView("hill", "research"), "board", "a stale lightweight hill value cannot strand research");
assert.equal(normalizeBoardView("hill", "explore"), "board", "a stale lightweight hill value cannot strand explore");
assert.equal(normalizeBoardView("list", "research"), "list", "supported lightweight views still persist");
assert.equal(normalizeBoardView("bogus", "build"), "board", "corrupt values degrade to board");
assert.throws(() => viewsForTrack("unknown"), /Unknown board track/, "unknown tracks fail at the view boundary");

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

console.log("board components test ok: view restrictions, metadata, and shared controls");
