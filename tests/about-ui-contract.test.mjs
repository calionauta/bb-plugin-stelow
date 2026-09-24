import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
const rendering = readFileSync(new URL("../components/app-support/panel-rendering.tsx", import.meta.url), "utf8");
const about = readFileSync(new URL("../components/settings/about-panel.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../components/settings/plugin-update-actions.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../components/settings/host-tools-section.tsx", import.meta.url), "utf8");
const status = readFileSync(new URL("../components/settings/plugin-update-status.tsx", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../components/settings/workflow-dependency-card.tsx", import.meta.url), "utf8");
const onboarding = readFileSync(new URL("../components/settings/preset-onboarding.tsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

test("app mounts About through the focused settings module", () => {
  assert.match(app, /<StelowPanelRoute\b/, "the app shell mounts the extracted panel route");
  assert.match(rendering, /import \{ AboutPanel \} from "\.\.\/settings\/about-panel"/);
  assert.match(rendering, /return <AboutPanel \/>/, "the About track renders the focused settings module");
  assert.doesNotMatch(app, /function (AboutPanel|HostToolsSection|PluginUpdateStatus)\(/);
});

test("About owns one tool lifecycle and delegates update lifecycle", () => {
  assert.match(about, /rpc\.call\("installTool", \{ id \}\)/);
  assert.match(about, /usePluginUpdateActions\(buildInfo, setBuildInfo\)/);
  assert.match(actions, /rpc\.call\("checkPluginUpdate", \{\}\)/);
  assert.match(actions, /rpc\.call\("applyPluginUpdate", \{\}\)/);
  assert.match(actions, /setPluginUpdateAvailable\(updateAvailableFrom\(result\)\)/,
    "a fresh check publishes its verdict to every update surface");
  assert.match(actions, /setPluginUpdateAvailable\(updateAvailableFrom\(info\)\)/,
    "post-apply build info republishes the refreshed verdict");
  assert.match(actions, /if \(started === state\) return/,
    "the lifecycle guard owns refusal of unconfirmed or duplicate apply calls");
  assert.equal((about.match(/rpc\.call\("toolStatus"/g) ?? []).length, 2,
    "initial status and successful-install refresh are the only probes");
});

test("About preserves its team pointer, width, and destructive confirmation", () => {
  assert.match(about, /className="grid max-w-2xl gap-5"/);
  assert.match(about, /see the experimental team playbook/);
  assert.match(about, /Clear onboarding state so every track shows its setup dialog again/);
  assert.match(about, /Show the first-visit setup dialogs again/);
});

test("BB Workflows status and explicit setup are wired into About and onboarding", () => {
  assert.match(workflow, /BB Workflows integration/);
  assert.match(workflow, /Install BB Workflows/);
  assert.match(workflow, /Enable BB Workflows/);
  assert.match(workflow, /Native execution is available for eligible Stelow recipes/);
  assert.match(onboarding, /<WorkflowDependencyCard compact \/>/);
  assert.match(about, /<WorkflowDependencyCard \/>/);
  assert.match(server, /"plugin", "install", "builtin:workflows"/);
  assert.match(server, /"plugin", "enable", "workflows"/);
  assert.match(server, /workflowDependencyStatus/);
});

test("tool rows preserve exclusive install and resilient presentation", () => {
  assert.match(tools, /disabled=\{disabled\}/);
  assert.match(tools, /installingId !== null/);
  assert.match(tools, /\{!present && !installing \?/);
  assert.match(tools, /Installing — can take a couple minutes/);
  assert.match(tools, /<InstallError message=\{error\} \/>/);
});

test("update actions remain guarded and unmanaged guidance is split", () => {
  assert.match(status, /function UpdateActions/);
  assert.match(status, /<UnmanagedUpdateCopy/);
  assert.match(status, /disabled=\{updating\}/);
  assert.match(status, /disabled=\{checking\}/);
  assert.match(status, /isPathInstall\(update\.installedDisplay\)/);
});

console.log("about UI contracts ok: focused settings mount and lifecycle topology");
