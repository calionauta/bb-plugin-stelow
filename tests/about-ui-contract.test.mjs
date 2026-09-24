import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
const about = readFileSync(new URL("../components/settings/about-panel.tsx", import.meta.url), "utf8");
const tools = readFileSync(new URL("../components/settings/host-tools-section.tsx", import.meta.url), "utf8");
const status = readFileSync(new URL("../components/settings/plugin-update-status.tsx", import.meta.url), "utf8");

test("app mounts About through the focused settings module", () => {
  assert.match(app, /import \{ AboutPanel \} from "\.\/components\/settings\/about-panel"/);
  assert.doesNotMatch(app, /function (AboutPanel|HostToolsSection|PluginUpdateStatus)\(/);
});

test("About owns one tool and update lifecycle", () => {
  assert.match(about, /rpc\.call\("installTool", \{ id \}\)/);
  assert.match(about, /rpc\.call\("checkPluginUpdate", \{\}\)/);
  assert.match(about, /rpc\.call\("applyPluginUpdate", \{\}\)/);
  assert.match(about, /APPLY_SETTLE_MS = 15_000/);
  assert.equal((about.match(/rpc\.call\("toolStatus"/g) ?? []).length, 2,
    "initial status and successful-install refresh are the only probes");
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
