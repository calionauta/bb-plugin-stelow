import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement as h } from "react";
import { browserStorage, readLastProjectId, rememberUsedProject, resolveDefaultProjectId, writeLastProjectId } from "../lib/last-project.mjs";
import { STORAGE_KEYS } from "../lib/panel-storage.mjs";
import { classesOf, findElementByType, loadComponent } from "./helpers/render-component.mjs";

// Last-project memory: the creation dialogs seed the SDK composer's project
// picker from the user's previous pick (global per-user key) and persist the
// project each successful submit actually used. Storage is convenience-only,
// so every helper treats a hostile store as absent and never throws.
//
// SCOPE7: the wiring that used to be six regexes over the creation dialogs,
// the seed hook, the dialog shell and the GitHub row is asked of the real
// modules here — the hook is driven through its open/submit lifecycle, both
// creation dialogs are MOUNTED and submitted, the compact shell is rendered
// in a compact viewport, and the row is rendered as a tree.

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    data,
  };
}

assert.equal(STORAGE_KEYS.lastProject, "stelow-last-project-v1", "the project key is versioned like every other panel key");

// read: absent, blank, and hostile stores all read as null.
assert.equal(readLastProjectId(memoryStore()), null, "empty store reads as absent");
assert.equal(readLastProjectId(memoryStore({ [STORAGE_KEYS.lastProject]: "" })), null, "blank reads as absent");
assert.equal(readLastProjectId(memoryStore({ [STORAGE_KEYS.lastProject]: "proj_b" })), "proj_b", "stored id round-trips");
assert.equal(readLastProjectId(null), null, "no store reads as absent");
assert.equal(readLastProjectId({}), null, "a store without getItem reads as absent");
assert.equal(readLastProjectId({ getItem: () => { throw new Error("denied"); } }), null, "a throwing store reads as absent");

// write: truthy ids persist, blanks never poison the key, hostile stores never throw.
{
  const store = memoryStore();
  writeLastProjectId(store, "proj_b");
  assert.equal(store.data.get(STORAGE_KEYS.lastProject), "proj_b", "truthy id persists");
  writeLastProjectId(store, "");
  writeLastProjectId(store, null);
  writeLastProjectId(store, undefined);
  assert.equal(store.data.get(STORAGE_KEYS.lastProject), "proj_b", "blank writes leave the previous pick intact");
  writeLastProjectId(null, "proj_b");
  writeLastProjectId({ setItem: () => { throw new Error("denied"); } }, "proj_b");
}

// resolve: the remembered pick beats ambient context while it still names a
// known project; anything else falls back to the host context.
assert.equal(resolveDefaultProjectId("proj_a", "proj_b", ["proj_a", "proj_b"]), "proj_b", "stored pick wins when valid");
assert.equal(resolveDefaultProjectId("proj_a", "proj_gone", ["proj_a", "proj_b"]), "proj_a", "unknown stored id falls back to host context");
assert.equal(resolveDefaultProjectId("proj_a", null, ["proj_a"]), "proj_a", "no memory falls back to host context");
assert.equal(resolveDefaultProjectId(null, "proj_b", ["proj_b"]), "proj_b", "memory alone seeds when context is empty");
assert.equal(resolveDefaultProjectId(null, null, []), null, "nothing known resolves to projectless");
assert.equal(resolveDefaultProjectId("proj_a", "proj_b"), "proj_b", "no validation list means the stored pick still wins");
assert.equal(resolveDefaultProjectId("", "", []), null, "blank ids resolve to projectless");

// remember: only real submits persist; projectless submits keep the old pick.
{
  const store = memoryStore({ [STORAGE_KEYS.lastProject]: "proj_a" });
  rememberUsedProject(store, "proj_b");
  assert.equal(store.data.get(STORAGE_KEYS.lastProject), "proj_b", "successful submit persists its project");
  rememberUsedProject(store, null);
  rememberUsedProject(store, "");
  assert.equal(store.data.get(STORAGE_KEYS.lastProject), "proj_b", "projectless submit keeps the previous pick");
}

// Asked before a DOM exists, so this stays the plain-node answer: no window is
// absent storage rather than a throw. Everything below boots a real DOM, so
// this is the last line that can see the windowless host.
assert.equal(browserStorage(), null, "no window in node reads as absent storage");

register(pathToFileURL(new URL("./register-tsx.mjs", import.meta.url).pathname), import.meta.url);
await import("./dom-setup.mjs");
const { render, screen, fireEvent, act, cleanup } = await import("@testing-library/react");

// --- the seed hook, driven through one open and one submit -----------------
// `useState` is the only React the hook needs, so the hook runs as a plain
// function over a cell list: the test reads the cell after the open handler
// runs, which is the value the next render would see.
function hookReact(cells) {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: "fragment",
    useState: (initial) => {
      const index = cells.index++;
      if (!(index in cells.values)) cells.values[index] = initial;
      return [cells.values[index], (next) => {
        cells.values[index] = typeof next === "function" ? next(cells.values[index]) : next;
      }];
    },
  };
}

const cells = { values: [], index: 0 };
const realLastProject = await import("../lib/last-project.mjs");
const useProjectSeed = loadComponent("components/creation/use-project-seed.ts", "useProjectSeed", {
  react: hookReact(cells),
  "../../lib/last-project.mjs": realLastProject,
});

const seedProps = { activeProjectId: "proj_a", validProjectIds: ["proj_a", "proj_b"] };
const opened = useProjectSeed(seedProps);
assert.equal(opened.seedProjectId, "proj_a", "a first open starts from the ambient project");

window.localStorage.setItem(STORAGE_KEYS.lastProject, "proj_b");
const resets = [];
const openChanges = [];
opened.openChange(true, (next) => openChanges.push(next), () => resets.push("reset"));
assert.deepEqual(openChanges, [true], "opening tells the host the dialog is open");
assert.equal(resets.length, 1, "and resets the dialog it is opening");
cells.index = 0;
const reopened = useProjectSeed(seedProps);
assert.equal(reopened.seedProjectId, "proj_b", "reopening seeds the remembered project over the ambient one");

await reopened.submitWithMemory({ projectId: "proj_c" }, async () => "card_1");
assert.equal(window.localStorage.getItem(STORAGE_KEYS.lastProject), "proj_c", "a successful submit remembers the project it used");
await reopened.submitWithMemory({ projectId: null }, async () => "card_2");
assert.equal(window.localStorage.getItem(STORAGE_KEYS.lastProject), "proj_b", "a submit without a project falls back to the seed it opened on");
await assert.rejects(
  reopened.submitWithMemory({ projectId: "proj_d" }, async () => { throw new Error("denied"); }),
  /denied/,
  "a failed submit still reaches the caller",
);
assert.equal(window.localStorage.getItem(STORAGE_KEYS.lastProject), "proj_b", "a submit that throws remembers nothing");

// --- the GitHub row, rendered as a tree -----------------------------------
// The repo select is bounded to its container: a long repo name must truncate,
// not push the dialog wider than the viewport.
const GithubCreateRow = loadComponent("components/github/github-create-row.tsx", "GithubCreateRow", {});
const row = GithubCreateRow({
  repos: ["octo/a", "octo/quite-long-repository-name"],
  checked: false,
  onCheckedChange: () => {},
  repo: null,
  onRepoChange: () => {},
});
const select = findElementByType(row, "select");
assert.ok(select, "several mapped repos force an explicit picker");
assert.ok(classesOf(select).includes("max-w-full"), "the repo select is bounded to its container");

// --- the creation dialogs, mounted ----------------------------------------
// Harness note: the SDK snapshots `useRpc`/`experimental_NewThreadComposer` from
// `globalThis.__bbPluginRuntime` at import time, so the stub precedes the
// component imports below.
const dialogCalls = [];
let submittedProjectId = "project_1";
const dialogRpc = {
  call: async (method, payload) => {
    dialogCalls.push({ method, payload });
    if (method === "createCard") return { cardId: "card_1", threadId: "thread_1" };
    if (method === "createExploreCard" || method === "createResearchCard") return { cardId: "card_1", threadId: "thread_1" };
    return { ok: true };
  },
};
// The composer is the SDK's; the stub is the only place the test can see what
// the dialog seeds, and its click is what submits.
let composerProps = null;
function TestComposer(props) {
  composerProps = props;
  return h("button", {
    type: "button",
    onClick: () => void props.onSubmit({
      projectId: submittedProjectId,
      input: [{ type: "text", text: "Build the thing." }],
      environment: null,
      providerId: "provider-a",
      model: "model-a",
      reasoningLevel: "high",
      permissionMode: "full",
    }),
  }, "Start build");
}

globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => dialogRpc,
    useBbNavigate: () => ({ openThreadPanel: () => {} }),
    experimental_NewThreadComposer: TestComposer,
  },
};
const { CreateBuildDialog } = await import("../components/creation/create-build-dialog.tsx");
const { CreateTrackDialog, EXPLORE_DIALOG_CONFIG, RESEARCH_DIALOG_CONFIG } = await import("../components/creation/create-track-dialog.tsx");
const { Dialog, DialogContent } = await import("../components/ui/dialog.tsx");
const { CompactViewportOverrideProvider } = await import("../components/ui/hooks/use-compact-viewport.tsx");

function buildDialogProps() {
  return {
    open: true,
    onOpenChange: () => {},
    activeProjectId: "project_1",
    validProjectIds: ["project_1"],
    analysisPreset: null,
    prefs: { quality: "production", supervisor: "high", explorationCount: "3", redFirst: "strict" },
    reviewGates: [],
    githubRepos: ["octo/a"],
    onPrefsChange: () => {},
    onReviewGatesChange: () => {},
    bucketGallery: { openBucketGallery: () => {}, bucketGallery: null },
    onOpenPresets: () => {},
  };
}

composerProps = null;
render(h(CreateBuildDialog, buildDialogProps()));
assert.equal(composerProps.defaultProjectId, "project_1", "the build dialog passes its project seed to the composer");
await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start build" })); });
assert.deepEqual(dialogCalls.map((call) => call.method), ["createCard"], "the submit creates the build card");
assert.equal(window.localStorage.getItem(STORAGE_KEYS.lastProject), "project_1", "and persists the project the submit used");
cleanup();

// A projectless submit never writes: the old pick survives a card that could
// not be created for want of a project.
dialogCalls.length = 0;
submittedProjectId = null;
composerProps = null;
render(h(CreateBuildDialog, { ...buildDialogProps(), activeProjectId: null, validProjectIds: [] }));
assert.equal(composerProps.defaultProjectId, undefined, "no project to seed means the composer stays unseeded");
await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start build" })); });
assert.deepEqual(dialogCalls, [], "a projectless submit creates nothing");
assert.equal(window.localStorage.getItem(STORAGE_KEYS.lastProject), "project_1", "and leaves the previous pick intact");
cleanup();

submittedProjectId = "project_1";
const trackProps = (config) => ({
  open: true,
  onOpenChange: () => {},
  activeProjectId: "project_1",
  validProjectIds: ["project_1"],
  catalog: [{ id: "map", label: "Map the terrain", emoji: "🗺", blurb: "Sketch the whole surface first." }],
  preset: { providerId: "p", modelId: "m", reasoningLevel: "high", permissionMode: "full", environmentKind: "worktree", name: "Explore preset" },
  hasBandPreset: true,
  bucketGallery: { openBucketGallery: () => {}, bucketGallery: null },
  onOpenPresets: () => {},
  config,
});

for (const [name, config, rpcName, payloadKey] of [
  ["explore", EXPLORE_DIALOG_CONFIG, "createExploreCard", "stageId"],
  ["research", RESEARCH_DIALOG_CONFIG, "createResearchCard", "strategy"],
]) {
  dialogCalls.length = 0;
  composerProps = null;
  window.localStorage.removeItem(STORAGE_KEYS.lastProject);
  render(h(CreateTrackDialog, trackProps(config)));
  assert.equal(composerProps.defaultProjectId, "project_1", `${name} passes the same project seed to the composer`);
  fireEvent.click(screen.getByRole("radio", { name: /Map the terrain/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start build" })); });
  assert.deepEqual(
    dialogCalls.map((call) => call.method),
    [rpcName],
    `${name} submits through its own RPC`,
  );
  assert.equal(dialogCalls[0].payload[payloadKey], "map", `${name} carries the picked catalog entry under its own key`);
  assert.equal(window.localStorage.getItem(STORAGE_KEYS.lastProject), "project_1", `${name} persists the project the submit used`);
  cleanup();
}

// --- the compact shell, rendered ------------------------------------------
// A phone-width dialog is fullscreen; the lateral clip is what keeps a long
// repo name from widening it and scrolling the page sideways.
render(h(CompactViewportOverrideProvider, { isCompactViewport: true },
  h(Dialog, { open: true, onOpenChange: () => {} },
    h(DialogContent, { fullscreenOnMobile: true }, h("p", null, "Dialog body")))));
const shell = document.querySelector("[role=dialog]");
assert.ok(shell, "a compact fullscreen dialog mounts");
assert.ok(shell.className.includes("overflow-x-hidden"), "the compact fullscreen shell clips lateral overflow");
assert.ok(screen.getByText("Dialog body"), "and the shell is the one the reader actually gets");
cleanup();

console.log("last project test ok: storage helpers, seed hook lifecycle, dialog seeds and persists, compact shell, bounded row");
