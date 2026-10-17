import assert from "node:assert/strict";
import {
  cardSubPath,
  inboxCardSubPath,
  parseStelowSubPath,
  trackOfCard,
  trackRootSubPath,
  trackTitle,
} from "../components/panel/stelow-route.mjs";
import { loadComponent, renderTree } from "./helpers/render-component.mjs";

const track = (value) => ({ kind: "track", track: value });

for (const value of ["", "/", "///", "build", "/build/"]) {
  assert.deepEqual(parseStelowSubPath(value), track("build"), `build route: ${JSON.stringify(value)}`);
}
for (const value of ["inbox", "/research/", "explore", "/about/"]) {
  const expected = value.replaceAll("/", "");
  assert.deepEqual(parseStelowSubPath(value), track(expected), `track route: ${value}`);
}
for (const origin of ["inbox", "build", "research", "explore"]) {
  assert.deepEqual(
    parseStelowSubPath(`${origin}/card/card_abc123`),
    { kind: "card", cardId: "card_abc123", eventId: null, executionRunId: null, origin },
    `${origin} card without an event keeps the route answerable`,
  );
}
assert.deepEqual(
  parseStelowSubPath("research/card/card_abc123/event/evt_xyz789"),
  { kind: "card", cardId: "card_abc123", eventId: "evt_xyz789", executionRunId: null, origin: "research" },
  "a prefixed card preserves its event and return track",
);
assert.deepEqual(
  parseStelowSubPath("build/card/card_abc123/run/exec_run1"),
  { kind: "card", cardId: "card_abc123", eventId: null, executionRunId: "exec_run1", origin: "build" },
  "a prefixed run route preserves the local run identity",
);
assert.deepEqual(
  parseStelowSubPath("card/card_abc123/event/evt_xyz/run/exec_run1"),
  { kind: "bare-card", cardId: "card_abc123", eventId: "evt_xyz", executionRunId: "exec_run1" },
  "a bare event-plus-run route remains answerable",
);
assert.deepEqual(
  parseStelowSubPath("card/card_abc123"),
  { kind: "bare-card", cardId: "card_abc123", eventId: null, executionRunId: null },
  "a trackless card route remains supported",
);
assert.deepEqual(
  parseStelowSubPath("/card/card_abc123/event/evt_xyz789/"),
  { kind: "bare-card", cardId: "card_abc123", eventId: "evt_xyz789", executionRunId: null },
  "padding around a trackless card route does not change its identity",
);
for (const value of [
  "unknown",
  "about/card/card_abc123",
  "build/card/not-a-card",
  "build/card/card_abc/event/not-an-event",
  "card/card_abc/event/evt_xyz/extra",
  "build/card/card_abc/run/wfr_native",
]) {
  assert.deepEqual(parseStelowSubPath(value), track("build"), `invalid path falls back safely: ${value}`);
}

const trackMetadata = [
  ["inbox", "Inbox", "inbox"],
  ["build", "Build", "build"],
  ["research", "Research", "research"],
  ["explore", "Explore", "explore"],
  ["about", "About", "about"],
];
for (const [key, title, root] of trackMetadata) {
  assert.equal(trackTitle(key), title, `${key} has one canonical title`);
  assert.equal(trackRootSubPath(key), root, `${key} has one canonical route root`);
}
for (const kind of ["build", "research", "explore"]) {
  assert.equal(trackOfCard({ kind }), kind, `${kind} cards stay on their source track`);
}
assert.equal(cardSubPath({ kind: "research" }, "card_abc123"), "research/card/card_abc123", "cards link under their track");
assert.equal(
  cardSubPath({ kind: "build" }, "card_abc123", "evt_xyz789"),
  "build/card/card_abc123/event/evt_xyz789",
  "card events are optional navigation targets",
);
assert.equal(inboxCardSubPath("card_abc123", "evt_xyz789"), "inbox/card/card_abc123/event/evt_xyz789", "inbox events always identify both ids");

// React has no mounted renderer here, so these wiring claims are asked of the
// components themselves — compiled and walked to a plain tree — rather than of
// their source text. An edit that changed what renders now fails here; a regex
// over the file could not tell the two apart.
const stelowPanel = loadComponent("components/panel/stelow-panel.tsx", "StelowPanel", {
  react: {
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  },
  "./stelow-tab-bar": { StelowTabBar: () => null },
  "./stelow-route.mjs": { parseStelowSubPath },
});

const seen = [];
const shellProps = {
  counts: { inbox: 0, build: 0, research: 0, explore: 0, about: 0 },
  aboutAlert: false,
  updateBadge: null,
  onSelectTrack: () => {},
  renderCard: () => ({ card: true }),
  renderTrack: (tab, active) => {
    seen.push({ tab, active });
    return null;
  },
};
renderTree(stelowPanel({ ...shellProps, subPath: "build" }));
assert.deepEqual(
  seen.filter((entry) => entry.active).map((entry) => entry.tab),
  ["build"],
  "only the selected keep-alive track receives active=true",
);
assert.deepEqual(
  seen.map((entry) => entry.tab),
  ["inbox", "build", "research", "explore", "about"],
  "every track stays mounted so subscriptions survive a tab switch",
);
seen.length = 0;
renderTree(stelowPanel({ ...shellProps, subPath: "about" }));
assert.deepEqual(
  seen.filter((entry) => entry.active).map((entry) => entry.tab),
  ["about"],
  "the active track follows the route rather than a fixed tab",
);

// The track renderer, rendered: each route mounts its own panel with the routed
// active state and the config object it imported.
const marker = (name) => {
  const fn = () => null;
  fn.displayName = name;
  return fn;
};
const EXPLORE_PANEL_CONFIG = { kind: "explore" };
const RESEARCH_PANEL_CONFIG = { kind: "research" };
const BuildPanel = marker("BuildPanel");
const TrackPanelForKind = marker("TrackPanelForKind");
const renderTrackPanel = loadComponent("components/app-support/panel-rendering.tsx", "renderTrackPanel", {
  "../panels/build-panel": { BuildPanel },
  "../panels/track-panel": { TrackPanelForKind },
  "../panels/track-panel-state": { EXPLORE_PANEL_CONFIG, RESEARCH_PANEL_CONFIG },
  "../panels/track-panel-view": { EXPLORE_VIEW_CONFIG: { kind: "explore" }, RESEARCH_VIEW_CONFIG: { kind: "research" } },
  "../panels/track-panel-dialogs": { EXPLORE_DIALOGS_CONFIG: { kind: "explore" }, RESEARCH_DIALOGS_CONFIG: { kind: "research" } },
  "../panels/inbox-panel": { InboxPanel: marker("InboxPanel") },
  "../settings/about-panel": { AboutPanel: marker("AboutPanel") },
  "../settings/preset-onboarding": { PresetOnboardingDialog: marker("PresetOnboardingDialog") },
  "../settings/preset-manager-shell": { PresetManagerDialog: marker("PresetManagerDialog") },
  "../detail/card-detail-route": { BareCardRoute: marker("BareCardRoute"), StelowCardDetail: marker("StelowCardDetail"), INTENT_LABEL: {} },
});

const build = renderTrackPanel("build", true);
assert.equal(build.type, BuildPanel, "build mounts the extracted Build panel");
assert.equal(build.props.active, true, "and forwards the routed active state");
const research = renderTrackPanel("research", false);
assert.equal(research.type, TrackPanelForKind, "research mounts through the generic track panel");
assert.equal(research.props.active, false, "research forwards active=false when it is not the selected tab");
assert.equal(research.props.panelConfig, RESEARCH_PANEL_CONFIG, "and passes the Research panel config it imported");
const explore = renderTrackPanel("explore", true);
assert.equal(explore.type, TrackPanelForKind, "explore mounts through the generic track panel");
assert.equal(explore.props.panelConfig, EXPLORE_PANEL_CONFIG, "with the Explore panel config");
assert.equal(explore.props.active, true, "and the routed active state");

console.log("panel routes test ok: tracks, cards, events, padding, active state, and safe fallback");
