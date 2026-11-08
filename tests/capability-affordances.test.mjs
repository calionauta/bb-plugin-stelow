import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createAgentGraphCapabilityHandlers, readAgentGraphCapabilityStatus } from "../server/runtime/agent-graph-capability.ts";
import { createPlatformHandlers } from "../server/runtime/platform.ts";
import { platformRpcContract } from "../server/platform-rpc-contract.ts";
import { loadComponent, treeText } from "./helpers/render-component.mjs";

/** Every element type the tree carries, without rendering the ones below it. */
function containsElement(node, type) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((child) => containsElement(child, type));
  if (node.type === type) return true;
  return (node.children ?? []).some((child) => containsElement(child, type));
}

const PLATFORM_DEPS = {
  bb: {},
  pluginDir: "/plugin",
  pluginSkillsDir: "/plugin/skills",
  buildInfo: { version: "0.0.0", builtAt: null },
  readPinnedStelowVersion: () => null,
  refreshPluginUpdate: async () => {},
  getPluginUpdate: () => ({
    outcome: "current", installed: null, installedDisplay: null, candidate: null,
    candidateDisplay: null, detail: null, checkedAt: null,
  }),
  getGithubRelease: () => null,
  resolveLocalBin: (name) => `/bin/${name}`,
  homeDir: "/home/test",
  localBinDir: "/home/test/bin",
  preview: { view: async () => null, start: async () => null, stop: async () => null, share: async () => null },
};

// SCOPE7: the wiring that used to be six regexes over the About panel, the
// capability panel, the graph action, the hero actions, the platform contract
// and the platform handlers is asked of the real modules here — the capability
// factory is driven with a recording CLI, the platform handler set is checked
// against the contract it publishes, the panels and the nudge are RENDERED, and
// About is asked for its tree instead of its text.

function cliResult(stdout, { code = 0, stderr = "" } = {}) {
  return { code, stdout, stderr };
}

function pluginList(rows) {
  return JSON.stringify({ plugins: rows });
}

test("a running Agent Graph reads as available with its version", () => {
  const status = readAgentGraphCapabilityStatus(cliResult(pluginList([
    { id: "agent-graph", version: "0.1.0", enabled: true, status: "running" },
  ])));
  assert.equal(status.available, true);
  assert.equal(status.installed, true);
  assert.equal(status.enabled, true);
  assert.equal(status.running, true);
  assert.equal(status.version, "0.1.0");
});

test("an enabled but still-starting Agent Graph is not available yet", () => {
  const status = readAgentGraphCapabilityStatus(cliResult(pluginList([
    { id: "agent-graph", version: "0.1.0", enabled: true, status: "starting" },
  ])));
  assert.equal(status.available, false);
  assert.equal(status.installed, true);
  assert.match(status.detail, /still starting/);
});

test("an installed but disabled Agent Graph is not available and names the enable path", () => {
  const status = readAgentGraphCapabilityStatus(cliResult(pluginList([
    { id: "agent-graph", version: "0.1.0", enabled: false, status: "stopped" },
  ])));
  assert.equal(status.available, false);
  assert.equal(status.installed, true);
  assert.match(status.detail, /Enable Agent Graph in BB Extensions/);
});

test("a readable answer without the row is really not installed", () => {
  const status = readAgentGraphCapabilityStatus(cliResult(pluginList([
    { id: "stelow", version: "0.65.11", enabled: true, status: "running" },
  ])));
  assert.equal(status.installed, false);
  assert.equal(status.available, false);
  assert.match(status.detail, /Install Agent Graph from BB Extensions/);
});

test("an unreadable answer never poses as not installed", () => {
  for (const stdout of ["", "   ", "not json at all", "{\"plugins\": \"nope\"}"]) {
    const status = readAgentGraphCapabilityStatus(cliResult(stdout));
    assert.equal(status.available, false);
    assert.match(status.detail, /did not answer/, `stdout ${JSON.stringify(stdout)} is a broken probe`);
    assert.doesNotMatch(status.detail, /Install Agent Graph/, "a broken probe names no install path");
  }
  const failed = readAgentGraphCapabilityStatus(cliResult("", { code: 1, stderr: "boom" }));
  assert.equal(failed.available, false);
  assert.match(failed.detail, /boom/);
});

test("the capability status is a contracted RPC answered by one read-only probe", async () => {
  // The contract is the surface the panel reads: a status missing a field the
  // panel renders is refused where it is produced.
  const contracted = platformRpcContract.agentGraphStatus;
  assert.equal(typeof contracted.experimental_description, "string", "the capability status is a contracted RPC");
  const status = readAgentGraphCapabilityStatus(cliResult(pluginList([
    { id: "agent-graph", version: "0.1.0", enabled: true, status: "running" },
  ])));
  assert.deepEqual(contracted.output.parse(status), status, "the probe's answer is the contracted shape");

  // The probe itself: one `bb plugin list`, and nothing that changes the host.
  // A capability that installed or enabled a plugin would be a second write
  // hiding behind a status read, so the recorded argv is the whole claim.
  const probes = [];
  const handlers = createAgentGraphCapabilityHandlers({
    runBbCli: async (args) => { probes.push(args); return cliResult(pluginList([{ id: "agent-graph", version: "0.1.0", enabled: true, status: "running" }])); },
  });
  assert.equal((await handlers.agentGraphStatus()).available, true, "the handler answers from the probe");
  assert.deepEqual(probes, [["plugin", "list", "--json"]], "detection reads the plugin list once and changes nothing");
});

test("the platform status handler answers through one read-only host-CLI probe", async () => {
  // The arrow the old pin named — platform -> capability factory -> host CLI —
  // driven end to end. The fake CLI is reached through the plugin's own
  // `BB_CLI` seam, refuses any argv but `plugin list --json`, and therefore
  // fails this test if the capability ever installs, enables, or shells
  // anything else behind a status read.
  const dir = mkdtempSync(join(tmpdir(), "stelow-bb-cli-"));
  const fake = join(dir, "bb");
  writeFileSync(fake, [
    "#!/bin/sh",
    '[ "$1 $2 $3" = "plugin list --json" ] || { echo "unexpected argv: $*" >&2; exit 3; }',
    `printf '%s' '${JSON.stringify({ plugins: [{ id: "agent-graph", version: "0.1.0", enabled: true, status: "running" }] })}'`,
  ].join("\n"), "utf8");
  chmodSync(fake, 0o755);
  const previous = process.env.BB_CLI;
  process.env.BB_CLI = fake;
  try {
    const status = await createPlatformHandlers(PLATFORM_DEPS).agentGraphStatus();
    assert.equal(status.available, true, "the platform handler answers through the host CLI, not a stubbed probe");
    assert.deepEqual(platformRpcContract.agentGraphStatus.output.parse(status), status, "and the answer is the contracted shape");
  } finally {
    if (previous === undefined) delete process.env.BB_CLI;
    else process.env.BB_CLI = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("About carries the capability panel in its tree", () => {
  // A tree, not a string: the panel has to be an element About renders, which
  // is a fact about the tree and not about the import line.
  const capabilityPanel = function CapabilityPanel() { return null; };
  const stubs = {
    react: { useState: (value) => [value, () => {}], useEffect: () => {} },
    "@get-bb/plugin-sdk/app": { UrlLink: () => null, useRpc: () => ({ call: async () => ({}) }) },
    sonner: { toast: { success: () => {} } },
    "../../lib/preset-onboarding-state.mjs": { resetOnboarding: () => {} },
    "../../lib/plugin-update.mjs": { updateAvailableFrom: () => false },
    "../../lib/plugin-update-signal.mjs": { setPluginUpdateAvailable: () => {} },
    "../../lib/host-tools.mjs": {
      beginToolInstall: (errors) => errors,
      finishToolInstall: (errors) => errors,
      mergeToolStatuses: (previous, tools) => tools ?? previous ?? [],
    },
    "../ui/button": { Button: () => null },
    "../ui/dialog": { Dialog: () => null, DialogContent: () => null, DialogDescription: () => null, DialogHeader: () => null, DialogTitle: () => null },
    "../ui/icon": { Icon: () => null },
    "./host-tools-section": { HostToolsSection: () => null },
    "./ui-design-mcp-section": { UiDesignMcpSection: () => null },
    "./plugin-update-actions": { usePluginUpdateActions: () => ({}) },
    "./plugin-update-status": { PluginUpdateStatus: () => null },
    "./update-badge": { UpdateBadge: () => null },
    "./workflow-dependency-card": { WorkflowDependencyCard: () => null },
    "./diagram-renderer-card": { DiagramRendererCard: () => null },
    "./capability-panel": { CapabilityPanel: capabilityPanel },
  };
  const AboutPanel = loadComponent("components/settings/about-panel.tsx", "AboutPanel", stubs);
  const tree = AboutPanel({});
  assert.ok(
    containsElement(tree, capabilityPanel),
    "About renders the capability panel, not only the import",
  );
  assert.ok(treeText(tree).includes("bb-plugin-stelow"), "and the rest of About is still there beside it");
});

// --- the rendered surfaces -------------------------------------------------
// Harness note: `@get-bb/plugin-sdk/app` snapshots its hooks from
// `globalThis.__bbPluginRuntime` at import time, so the stub precedes the
// component imports below.
const rpcCalls = [];
const navigations = [];
const threadVisits = [];
const UNAVAILABLE = {
  id: "agent-graph", name: "Agent Graph", installed: false, enabled: false, running: false,
  available: false, version: null,
  detail: "Install Agent Graph from BB Extensions to watch a card's agent as a live node graph.",
};
const AVAILABLE = { ...UNAVAILABLE, installed: true, enabled: true, running: true, available: true, version: "0.1.0" };
let capabilityStatus = UNAVAILABLE;
// One stable rpc, like the host's: a fresh object per render would re-run every
// effect that depends on it for a reason the real app cannot produce.
const rpc = {
  call: async (method, payload) => {
    rpcCalls.push({ method, payload });
    return method === "agentGraphStatus" ? capabilityStatus : {};
  },
};
const navigate = {
  toPluginPanel: (panelId, options) => navigations.push({ panelId, options }),
  toThread: (threadId) => threadVisits.push(threadId),
};
globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => rpc,
    useBbNavigate: () => navigate,
  },
};
register(pathToFileURL(new URL("./register-tsx.mjs", import.meta.url).pathname), import.meta.url);
await import("./dom-setup.mjs");
const { createElement: h } = await import("react");
const { render, screen, fireEvent, act, cleanup } = await import("@testing-library/react");
const { CapabilityPanel } = await import("../components/settings/capability-panel.tsx");
const { GraphNudge } = await import("../components/graph/agent-graph-action.tsx");
const { DetailHeroActions } = await import("../components/detail/detail-hero-actions.tsx");
const { STELOW_PANEL_ID } = await import("../components/panel/stelow-route.mjs");

test("the capability panel reads the status and points where the reader can act", async () => {
  rpcCalls.length = 0;
  render(h(CapabilityPanel));
  await act(async () => {});
  assert.deepEqual(rpcCalls, [{ method: "agentGraphStatus", payload: {} }], "the panel asks the capability RPC on mount");
  assert.ok(screen.getByLabelText("Live-graph capability"), "the panel labels its own region");
  assert.ok(screen.getByText("Find it in BB → Extensions as Agent Graph."), "an absent capability points where the reader can act");
  assert.equal(screen.queryByRole("button", { name: /install|enable/i }), null, "and the panel offers no install or enable control");

  capabilityStatus = AVAILABLE;
  cleanup();
  render(h(CapabilityPanel));
  await act(async () => {});
  assert.ok(screen.getByText(/^Running/), "a running capability reads as running");
  assert.ok(screen.getByText(/· v0.1.0/), "and reports the version it detected");
  assert.deepEqual(
    rpcCalls.map((call) => call.method),
    ["agentGraphStatus", "agentGraphStatus"],
    "one read per mount, and detection never writes anything back",
  );
  cleanup();
});

test("the nudge sends the reader to About and dismisses into storage", async () => {
  capabilityStatus = UNAVAILABLE;
  window.localStorage.removeItem("stelow-hide-graph-nudge");
  navigations.length = 0;
  render(h(GraphNudge, { threadId: "thr_1" }));
  await act(async () => {});
  assert.equal(screen.queryByText(/See live graph/), null, "the overpromising label is gone with the button");
  assert.ok(screen.getByText(/doing live/), "the nudge names what the capability would show");

  fireEvent.click(screen.getByRole("button", { name: "Open About" }));
  assert.deepEqual(navigations, [{ panelId: STELOW_PANEL_ID, options: { subPath: "about" } }], "the nudge sends the reader to About, where capabilities live");

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); });
  assert.equal(window.localStorage.getItem("stelow-hide-graph-nudge"), "1", "dismissing remembers itself in storage");
  assert.equal(screen.queryByText(/doing live/), null, "and takes the nudge off the card");
  cleanup();

  // An available capability, or a card with no worker thread, offers nothing.
  capabilityStatus = AVAILABLE;
  render(h(GraphNudge, { threadId: "thr_1" }));
  await act(async () => {});
  assert.equal(screen.queryByText(/doing live/), null, "a live graph is never nudged");
  cleanup();
  capabilityStatus = UNAVAILABLE;
  window.localStorage.removeItem("stelow-hide-graph-nudge");
  render(h(GraphNudge, { threadId: null }));
  await act(async () => {});
  assert.equal(screen.queryByText(/doing live/), null, "a card with no thread has nothing to watch");
  cleanup();
});

test("every hero shape keeps exactly one thread opener", async () => {
  // The live-graph button that used to sit here duplicated Open thread's
  // destination under a misleading label, because no cross-plugin thread-panel
  // seam exists. One opener per shape is the rule that replaced it.
  capabilityStatus = UNAVAILABLE;
  for (const heroKind of ["working", "error", "decision", "paused"]) {
    threadVisits.length = 0;
    window.localStorage.removeItem("stelow-hide-graph-nudge");
    render(h(DetailHeroActions, {
      card: { activity: "running", status: "in-progress", workerThreadId: "thr_1", lastError: null },
      heroKind,
      pending: false,
      preset: { stale: false, providerId: null, modelId: null },
      state: { starting: false, retrying: false, restarting: false },
      continuation: "Continue the same worker",
      onStart: async () => {},
      onRetry: async () => {},
      onRestart: () => {},
    }));
    await act(async () => {});
    const openers = screen.getAllByRole("button", { name: /Open thread/ });
    assert.equal(openers.length, 1, `${heroKind} offers exactly one thread opener`);
    fireEvent.click(openers[0]);
    assert.deepEqual(threadVisits, ["thr_1"], `${heroKind} opens the card's own worker thread`);
    assert.ok(screen.getByText(/doing live/), `${heroKind} carries the absent-capability nudge, which points somewhere real`);
    assert.equal(screen.queryByText(/See live graph/), null, `${heroKind} has no look-alike opener`);
    cleanup();
  }
});

console.log("capability affordances test ok: status verdicts, contract, one read-only probe, platform wiring, rendered panels");
