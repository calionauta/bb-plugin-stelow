import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readAgentGraphCapabilityStatus } from "../server/runtime/agent-graph-capability.ts";

const about = readFileSync(new URL("../components/settings/about-panel.tsx", import.meta.url), "utf8");
const capability = readFileSync(new URL("../components/settings/capability-panel.tsx", import.meta.url), "utf8");
const action = readFileSync(new URL("../components/graph/agent-graph-action.tsx", import.meta.url), "utf8");
const hero = readFileSync(new URL("../components/detail/detail-hero-actions.tsx", import.meta.url), "utf8");
const contract = readFileSync(new URL("../server/platform-rpc-contract.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../server/runtime/platform.ts", import.meta.url), "utf8");

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

test("the capability status is a contracted RPC wired to one CLI probe", () => {
  assert.match(contract, /agentGraphStatus: \{/, "the capability status is a contracted RPC");
  assert.match(platform, /agentGraphStatus: \(\) => agentGraphCapability\.agentGraphStatus\(\),/,
    "the handler answers from one `bb plugin list` probe");
  assert.match(platform, /createAgentGraphCapabilityHandlers\(\{ runBbCli: runHostBbCli \}\)/,
    "the probe runs through the host CLI, never an isolated shell");
});

test("About carries the capability panel and nothing installs from it", () => {
  assert.match(about, /import \{ CapabilityPanel \} from "\.\/capability-panel"/);
  assert.match(about, /<CapabilityPanel \/>/, "About renders the capability panel");
  assert.match(capability, /rpc\.call\("agentGraphStatus", \{\}\)/);
  assert.match(capability, /aria-label="Live-graph capability"/);
  assert.match(capability, /Find it in BB → Extensions as Agent Graph\./,
    "an absent capability points where the reader can act");
  assert.doesNotMatch(
    [capability, action].join("\n"),
    /plugin", "(install|enable)"|fetch\(|child_process|execFile/,
    "detection never changes the host: no install, no enable, no shell",
  );
});

test("the card hero keeps one thread opener, never a look-alike", () => {
  // No cross-plugin thread-panel seam exists (openThreadPanel and
  // toPluginPanel are own-plugin only; Agent Graph exposes no
  // thread-addressed route), so a "live graph" button could only duplicate
  // Open thread's destination under a misleading label. One opener stays.
  assert.doesNotMatch(hero, /<OpenGraphButton /, "no second thread opener beside Open thread");
  assert.doesNotMatch(action, /See live graph/, "the overpromising label is gone with the button");
  const threadSites = hero.match(/<OpenThreadButton /g) ?? [];
  assert.ok(threadSites.length >= 3, "the hero keeps its thread sites");
  assert.match(hero, /<GraphNudge threadId=\{card\.workerThreadId\} \/>/, "the absent-capability nudge stays: it points somewhere real");
  assert.match(action, /stelow-hide-graph-nudge/, "the nudge dismisses into localStorage");
  assert.match(action, /toPluginPanel\(STELOW_PANEL_ID, \{ subPath: "about" \}\)/,
    "the nudge sends the reader to About, where capabilities live");
});
