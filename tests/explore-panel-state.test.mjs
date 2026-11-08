import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import {
  exploreCardListRequest,
  exploreCardMatches,
  explorePresetFor,
  filterAndGroupExploreCards,
  techniqueLabelsById,
} from "../lib/explore-panel-state.mjs";
import { loadComponent, renderTree } from "./helpers/render-component.mjs";
import { panelHeaderStub } from "./helpers/panel-header-stub.mjs";

// Explore is a config of the generic track panel, not a shell of its own. The
// pins that used to guard that delegation as text — five regexes over four
// components and a module-private loader — are asked of the real modules here:
// the loader is DRIVEN with a recording rpc, the config objects the components
// build from are the ones asserted against, and the panel, dialog and view
// trees are INSPECTED where the old pins described their text.

/** The deepest node with `type`, without rendering anything below it. */
function findElement(node, type) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (node.type === type) return node;
  for (const child of node.children ?? []) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

/** Every node in the tree, without rendering function components. */
function allElements(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) allElements(child, found);
    return found;
  }
  found.push(node);
  for (const child of node.children ?? []) allElements(child, found);
  return found;
}

function textOf(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!node || typeof node !== "object") return "";
  return (node.children ?? []).map(textOf).join("");
}

// --- the data layer is already behavior ----------------------------------
assert.deepEqual(
  exploreCardListRequest("project_1"),
  { projectId: "project_1", kind: "explore" },
  "explore loads only the active project's exploration cards",
);

const cards = [
  { id: "card_old", projectId: "project_1", status: "inbox", needsAttention: false, updatedAt: 1 },
  { id: "card_new", projectId: "project_1", status: "in-progress", needsAttention: true, updatedAt: 2 },
  { id: "card_other", projectId: "project_2", status: "inbox", needsAttention: true, updatedAt: 3 },
];
const filters = { columns: ["inbox", "doing", "done", "archived"], projectIds: ["project_1"], attention: true };
assert.equal(exploreCardMatches(cards[0], filters), false, "attention filter excludes ordinary cards");
assert.deepEqual(filterAndGroupExploreCards(cards, filters), {
  inbox: [],
  doing: [cards[1]],
  done: [],
  archived: [],
}, "filtered groups keep the lightweight columns and newest ordering");

assert.deepEqual(
  [...techniqueLabelsById([{ id: "map", label: "Map the terrain" }])],
  [["map", "Map the terrain"]],
  "technique labels preserve the catalog ids",
);
assert.deepEqual(
  explorePresetFor(
    [{ id: "default", isDefault: true }, { id: "explore" }],
    [{ band: "explore", presetId: "explore" }],
  ),
  { preset: { id: "explore" }, hasBandPreset: true },
  "an explore assignment wins over the board default",
);
assert.deepEqual(
  explorePresetFor([{ id: "default", isDefault: true }], []),
  { preset: { id: "default", isDefault: true }, hasBandPreset: false },
  "explore falls back to the board default without an assignment",
);

register(pathToFileURL(new URL("./register-tsx.mjs", import.meta.url).pathname), import.meta.url);

// --- the generic loader, driven with a recording rpc ----------------------
// `useState`/`useCallback`/`useMemo` are the only React the loader needs, and
// `usePanelData` is the one hook that receives the loader — so the test holds
// the loader a mounted panel would call and runs it.
const hookCalls = [];
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: "fragment",
  useState: (initial) => {
    const index = reactStub.cells.index++;
    if (!(index in reactStub.cells.values)) reactStub.cells.values[index] = initial;
    return [reactStub.cells.values[index], (next) => { reactStub.cells.values[index] = next; }];
  },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  cells: { values: [], index: 0 },
};
const panelHooksStub = {
  usePanelData: (loadData, options) => {
    hookCalls.push({ loadData, options });
    return {
      data: { cards: [], presets: [], projects: [], bandPresets: [], catalog: [] },
      grouped: { inbox: [] },
      load: async () => {},
      preset: { preset: null, hasBandPreset: false },
      isInitialLoad: false,
    };
  },
  usePersistentCollapsedGroups: () => [[], () => {}],
  useCollapsedGroups: () => [[], () => {}],
  useBoardView: () => ["board", () => {}],
};

const realTracks = await import("../lib/tracks.mjs");
const realKanban = await import("../lib/kanban-layout.mjs");
const realTrackState = await import("../lib/track-panel-state.mjs");
const useTrackPanelState = loadComponent("components/panels/track-panel-state.ts", "useTrackPanelState", {
  react: reactStub,
  "../panel/panel-state-hooks": panelHooksStub,
  "../../lib/tracks.mjs": realTracks,
  "../../lib/kanban-layout.mjs": realKanban,
  "../../lib/track-panel-state.mjs": realTrackState,
});
const { EXPLORE_PANEL_CONFIG, RESEARCH_PANEL_CONFIG } = await import("../components/panels/track-panel-state.ts");

assert.equal(EXPLORE_PANEL_CONFIG.catalogRpc, "stageCatalog", "Explore keeps its technique catalog behind the generic loader");
assert.equal(EXPLORE_PANEL_CONFIG.kind, "explore", "and loads the explore board");
assert.equal(RESEARCH_PANEL_CONFIG.catalogRpc, "researchStrategies", "Research is the same loader with its own catalog rpc");

for (const [name, config, catalogKey] of [
  ["Explore", EXPLORE_PANEL_CONFIG, "stages"],
  ["Research", RESEARCH_PANEL_CONFIG, "strategies"],
]) {
  hookCalls.length = 0;
  reactStub.cells = { values: [], index: 0 };
  const rpcCalls = [];
  const rpc = {
    call: async (method, payload) => {
      rpcCalls.push({ method, payload });
      if (method === "projects") return { projects: [] };
      if (method === "listCards") return { cards: [] };
      if (method === config.catalogRpc) return { [catalogKey]: [] };
      if (method === "listPresets") return { presets: [] };
      if (method === "listBandPresets") return { bands: [] };
      return {};
    },
  };
  useTrackPanelState(rpc, "project_1", config);
  assert.deepEqual(
    hookCalls[0].options.realtimeChannels,
    ["card-state", "board-changed", "inbox-changed"],
    `${name} refreshes cards, boards, and inbox-driven state changes`,
  );
  await hookCalls[0].loadData();
  assert.deepEqual(
    rpcCalls,
    [
      { method: "projects", payload: {} },
      { method: "listCards", payload: { projectId: "project_1", kind: config.kind } },
      { method: config.catalogRpc, payload: {} },
      { method: "listPresets", payload: {} },
      { method: "listBandPresets", payload: {} },
    ],
    `${name} fetches its dialog and board datasets through one loader and no others`,
  );
}

// --- the generic panel, asked for its tree --------------------------------
const marker = (props) => props;
const navigate = { threads: [], toThread(threadId) { this.threads.push(threadId); } };
let panelLoads = 0;
const panelState = {
  grouped: { inbox: [] },
  load: async () => { panelLoads += 1; },
  data: {},
  preset: null,
  isInitialLoad: false,
};
const TrackPanel = loadComponent("components/panels/track-panel.tsx", "TrackPanel", {
  react: reactStub,
  "@get-bb/plugin-sdk/app": {
    useBbContext: () => ({ projectId: "project_1" }),
    useBbNavigate: () => navigate,
    useRpc: () => ({ call: async () => ({}) }),
  },
  "../panel/stelow-focus.mjs": { rememberStelowReturnFocusCardId: () => {} },
  "../panel/stelow-route.mjs": await import("../components/panel/stelow-route.mjs"),
  "../board/card-gallery": { useBucketGallery: () => ({ openBucketGallery: () => {}, bucketGallery: null }) },
  "../panel/track-skeleton": { TrackSkeleton: marker },
  "./track-panel-state": { useTrackPanelState: () => panelState },
  "./track-panel-view": { TrackListForKind: marker, TrackPanelView: marker, renderTrackCardForKind: () => null },
  "./track-panel-dialogs": { TrackPanelDialogs: marker },
});
reactStub.cells = { values: [], index: 0 };
const panelTree = TrackPanel({
  active: true,
  renderOnboarding: () => null,
  renderPresetManager: () => null,
  usePanelState: () => panelState,
  PanelDialogs: marker,
  PanelView: marker,
  newViewProp: "onNewExplore",
});
const view = findElement(panelTree, marker);
assert.ok(view, "the panel mounts its view");
view.props.onOpenThread("thr_9");
assert.deepEqual(navigate.threads, ["thr_9"], "Explore threads reach the host router");
assert.equal(typeof view.props.onNewExplore, "function", "and the panel's own create action arrives under the view's own prop name");
assert.equal(view.props.dialogs.type, marker, "the panel hands its dialogs element to the view");
await view.props.dialogs.props.onChanged();
assert.equal(panelLoads, 1, "preset changes refresh the active Explore panel");
// The move policy went with the drop target it served, and this tree is where
// its absence is observable: no element here carries a manual move prop.
const moveProps = allElements(panelTree)
  .flatMap((element) => Object.keys(element.props ?? {}))
  .filter((prop) => /onMoveCard|moveExploreCard/.test(prop));
assert.deepEqual(moveProps, [], "no manual card-move control survives in the Explore track");

// --- the generic dialogs, asked for their tree ----------------------------
const trackDialogs = loadComponent("components/panels/track-panel-dialogs.tsx", "TrackPanelDialogs", {
  "../creation/create-track-dialog": {
    CreateTrackDialog: marker,
    EXPLORE_DIALOG_CONFIG: { kind: "explore" },
    RESEARCH_DIALOG_CONFIG: { kind: "research" },
  },
  "../../lib/panel-storage.mjs": await import("../lib/panel-storage.mjs"),
});
const { EXPLORE_DIALOGS_CONFIG, RESEARCH_DIALOGS_CONFIG } = await import("../components/panels/track-panel-dialogs.tsx");
for (const [name, config] of [
  ["Explore", EXPLORE_DIALOGS_CONFIG],
  ["Research", RESEARCH_DIALOGS_CONFIG],
]) {
  const onboarding = [];
  const manager = [];
  const preset = { preset: { id: "band-preset" }, hasBandPreset: true };
  const data = { projects: [{ id: "project_1", name: "One" }], stages: ["map"], strategies: ["deep"], presets: [{ id: "band-preset" }] };
  const onChanged = async () => {};
  const tree = trackDialogs({
    active: true,
    projectId: "project_1",
    data,
    preset,
    rpc: {},
    createOpen: true,
    presetsOpen: false,
    onCreateOpenChange: () => {},
    onPresetsOpenChange: () => {},
    onOpenPresets: () => {},
    bucketGallery: { openBucketGallery: () => {}, bucketGallery: null },
    onChanged,
    renderOnboarding: (props) => { onboarding.push(props); return null; },
    renderPresetManager: (props) => { manager.push(props); return null; },
    config,
  });
  const createDialog = findElement(tree, marker);
  assert.equal(createDialog.props.activeProjectId, "project_1", `${name} creation receives the active project`);
  assert.deepEqual(createDialog.props.catalog, data[config.catalogProp], `${name} creation receives its own catalog`);
  assert.equal(createDialog.props.preset, preset.preset, `${name} creation receives the resolved preset`);
  assert.equal(createDialog.props.hasBandPreset, true, `${name} creation is told whether the band preset is real`);
  assert.equal(createDialog.props.config, config.dialogConfig, `${name} creation delegates with its own dialog config`);
  assert.equal(onboarding[0].storageKey, config.onboardKey, `${name} onboarding keeps its own storage key`);
  assert.equal(onboarding[0].active, true, `${name} onboarding is told whether the panel is live`);
  assert.equal(manager[0].presets, data.presets, `${name} preset management keeps the live preset list`);
  assert.equal(manager[0].onChanged, onChanged, `${name} preset management keeps its refreshable wiring`);
}

// --- the generic view, asked for its tree ---------------------------------
// The view's own header/filters/board are module-local components, so the tree
// is resolved (helpers' `renderTree`) before it is asked anything; every stubbed
// dependency renders to a named node instead of a bare marker.
const stubFor = (tag) => ({ children, ...props }) => ({ type: `stub:${tag}`, props, children: children ?? [] });
const trackView = loadComponent("components/panels/track-panel-view.tsx", "TrackPanelView", {
  "../../lib/utils": await import("../lib/utils"),
  "../../lib/kanban-layout.mjs": realKanban,
  "../board/board-cards": { LightweightTrackCard: stubFor("LightweightTrackCard") },
  "../board/track-lists": { TrackList: stubFor("TrackList") },
  "../../lib/tracks.mjs": realTracks,
  "../panel/stelow-route.mjs": await import("../components/panel/stelow-route.mjs"),
  "../board/board-filters": { FiltersBar: stubFor("FiltersBar") },
  "../board/board-view-toggle": { ViewToggle: stubFor("ViewToggle") },
  "../board/board-column": { BoardColumn: stubFor("BoardColumn") },
  "./panel-header": panelHeaderStub(),
  "../board/archived-delete-props": { archivedDeleteProps: (args) => args },
  "../board/use-delete-archived-cards": { useDeleteArchivedCards: () => () => {} },
  "@get-bb/plugin-sdk/app": { useRpc: () => ({ call: async () => ({}) }) },
  "../../lib/board-list-presentation.mjs": await import("../lib/board-list-presentation.mjs"),
  "../../lib/detail-presentation.mjs": await import("../lib/detail-presentation.mjs"),
  "../board/card-gallery": { BucketGalleryButton: stubFor("BucketGalleryButton") },
  "../ui/button": { Button: stubFor("Button") },
  "../ui/icon": { Icon: stubFor("Icon") },
});
const { EXPLORE_VIEW_CONFIG, RESEARCH_VIEW_CONFIG } = await import("../components/panels/track-panel-view.tsx");
for (const config of [EXPLORE_VIEW_CONFIG, RESEARCH_VIEW_CONFIG]) {
  const tree = trackView({
    state: {
      attentionCount: 0, setAttention: () => {}, grouped: {}, projectIds: [], attention: false,
      toggleProject: () => {}, reset: () => {}, viewMode: "board", setViewMode: () => {},
      collapsedColumns: {}, collapsedListGroups: {}, toggleColumn: () => {}, toggleListGroup: () => {},
      labels: new Map(), data: { projects: [] },
    },
    dialogs: null,
    onNewTrack: () => {},
    onOpenPresets: () => {},
    onOpenCard: () => {},
    onOpenThread: () => {},
    config,
    List: stubFor("List"),
    renderCard: () => null,
  });
  const elements = allElements(renderTree(tree));
  assert.equal(textOf(findElement(elements, "h1")), config.title, `${config.kind} view title comes from its config`);
  const toggle = elements.find((element) => element.props?.track !== undefined);
  assert.equal(toggle.props.track, config.kind, `${config.kind} view toggle is told which track it switches`);
  assert.equal(toggle.props.label, config.viewLabel, `${config.kind} view toggle carries the config's own label`);
  const buttons = elements.filter((element) => element.type === "stub:Button");
  assert.ok(
    buttons.some((button) => textOf(button).includes(config.newLabel)),
    `${config.kind} new-track action is named by its config`,
  );
  assert.ok(
    buttons.some((button) => button.props?.title === config.presetsTitle),
    `${config.kind} preset action is titled by its config`,
  );
  assert.equal(
    elements.filter((element) => element.type === "stub:BoardColumn").length,
    realTracks.LIGHTWEIGHT_VISIBLE_COLUMNS.length,
    `${config.kind} board renders one column per lightweight column`,
  );
}

// --- the tab router, asked for its tree ------------------------------------
// The old pin read panel-rendering.tsx to check the explore tab mounts the
// generic panel with its own three configs. Asked of the tree instead, and by
// identity: the router must hand the panel the very objects the panel, the view
// and the dialogs were built from.
const TrackPanelForKindStub = stubFor("TrackPanelForKind");
const BuildPanelStub = stubFor("BuildPanel");
const InboxPanelStub = stubFor("InboxPanel");
const AboutPanelStub = stubFor("AboutPanel");
const panelRendering = loadComponent("components/app-support/panel-rendering.tsx", "renderTrackPanel", {
  "../panels/build-panel": { BuildPanel: BuildPanelStub },
  "../panels/track-panel": { TrackPanelForKind: TrackPanelForKindStub },
  "../panels/track-panel-state": { EXPLORE_PANEL_CONFIG, RESEARCH_PANEL_CONFIG },
  "../panels/track-panel-view": { EXPLORE_VIEW_CONFIG, RESEARCH_VIEW_CONFIG },
  "../panels/track-panel-dialogs": { EXPLORE_DIALOGS_CONFIG, RESEARCH_DIALOGS_CONFIG },
  "../panels/inbox-panel": { InboxPanel: InboxPanelStub },
  "../settings/about-panel": { AboutPanel: AboutPanelStub },
  "../settings/preset-onboarding": { PresetOnboardingDialog: stubFor("PresetOnboardingDialog") },
  "../settings/preset-manager-shell": { PresetManagerDialog: stubFor("PresetManagerDialog") },
  "../detail/card-detail-route": {
    BareCardRoute: stubFor("BareCardRoute"),
    StelowCardDetail: stubFor("StelowCardDetail"),
    INTENT_LABEL: {},
  },
  // The router's fourth case: the narrow question door. Stubbed like the rest,
  // because this test is about which panel a tab mounts, not about the door.
  "../detail/card-ask-body": { CardAskBody: stubFor("CardAskBody") },
  "../panels/inbox-panel-actions": {
    goToInboxCard: () => undefined,
    goToInboxAsk: () => undefined,
    goToHolderCard: () => undefined,
  },
});
const explorePanel = findElement(panelRendering("explore", true), TrackPanelForKindStub);
assert.ok(explorePanel, "the explore tab mounts through the generic track panel");
assert.equal(explorePanel.props.panelConfig, EXPLORE_PANEL_CONFIG, "explore mounts with the explore panel config");
assert.equal(explorePanel.props.viewConfig, EXPLORE_VIEW_CONFIG, "explore mounts with the explore view config");
assert.equal(explorePanel.props.dialogsConfig, EXPLORE_DIALOGS_CONFIG, "explore mounts with the explore dialogs config");
assert.equal(explorePanel.props.active, true, "and the live flag reaches the panel");
const researchPanel = findElement(panelRendering("research", false), TrackPanelForKindStub);
assert.equal(researchPanel.props.panelConfig, RESEARCH_PANEL_CONFIG, "research mounts with the research panel config");
assert.equal(researchPanel.props.viewConfig, RESEARCH_VIEW_CONFIG, "research mounts with the research view config");
assert.equal(researchPanel.props.dialogsConfig, RESEARCH_DIALOGS_CONFIG, "research mounts with the research dialogs config");
assert.ok(findElement(panelRendering("about", false), AboutPanelStub), "an unrouted tab falls through to About");
assert.ok(findElement(panelRendering("inbox", false), InboxPanelStub), "and the inbox tab is still the inbox panel");
assert.ok(findElement(panelRendering("build", false), BuildPanelStub), "and the build tab is still the build panel");

console.log("explore panel state test ok: data, config-driven loader, panel tree, dialog tree, generic view, tab router");
