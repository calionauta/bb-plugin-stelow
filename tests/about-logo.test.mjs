import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  ABOUT_LOGO_BUDGET_BYTES,
  ABOUT_LOGO_FILE,
  loadAboutLogo,
  resolveAboutLogoPath,
  toLogoDataUri,
} from "../lib/about-logo.mjs";

// Pure helpers: data URI shape and failure modes.
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const uri = toLogoDataUri(bytes);
assert.ok(uri?.startsWith("data:image/png;base64,"), "logo travels as a PNG data URI");
assert.equal(Buffer.from(uri.split(",")[1], "base64").length, bytes.length, "data URI round-trips the bytes");
assert.equal(toLogoDataUri(new Uint8Array()), null, "empty bytes yield no logo");
assert.equal(toLogoDataUri(null), null, "missing bytes yield no logo");

assert.equal(resolveAboutLogoPath(""), null, "empty root yields no path");
assert.equal(resolveAboutLogoPath("/root"), "/root/" + ABOUT_LOGO_FILE.join("/"), "logo resolves under the plugin root");

assert.equal(loadAboutLogo("/nonexistent", () => { throw new Error("ENOENT"); }), null, "missing asset yields no logo, never a throw");
assert.equal(
  loadAboutLogo("/root", () => Buffer.from(bytes)),
  toLogoDataUri(bytes),
  "present asset loads through the injected reader",
);

// Real asset: tracked, valid PNG, inside budget (displayed at most 256px
// wide; the budget keeps the lazy About fetch cheap).
const assetUrl = new URL("../" + ABOUT_LOGO_FILE.join("/"), import.meta.url);
assert.equal(existsSync(assetUrl), true, "Stelow logo is tracked as a plugin asset");
const asset = readFileSync(assetUrl);
assert.deepEqual(Array.from(asset.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], "logo asset is a real PNG");
assert.ok(asset.length < ABOUT_LOGO_BUDGET_BYTES, `logo asset ${asset.length}B exceeds ${ABOUT_LOGO_BUDGET_BYTES}B budget`);
assert.ok(statSync(assetUrl).size > 10 * 1024, "logo asset is not a placeholder");

// Contracts: the frontend must never reference a runtime static-asset URL
// (bb serves only the built app.js/app.css, so it always 404s); the server
// must expose the logo over RPC instead.
const app = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
const supportSidebar = readFileSync(new URL("../components/app-support/sidebar-accessories.tsx", import.meta.url), "utf8");
const about = readFileSync(new URL("../components/settings/about-panel.tsx", import.meta.url), "utf8");
const hostTools = readFileSync(new URL("../components/settings/host-tools-section.tsx", import.meta.url), "utf8");
const updateActions = readFileSync(new URL("../components/settings/plugin-update-actions.ts", import.meta.url), "utf8");
const updateStatus = readFileSync(new URL("../components/settings/plugin-update-status.tsx", import.meta.url), "utf8");
const aboutUi = `${about}\n${hostTools}\n${updateActions}\n${updateStatus}`;
assert.doesNotMatch(app, /new URL\("\.\/assets\//, "frontend never builds a runtime static-asset URL");
const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
assert.match(server, /aboutLogo:\s*\{/, "server exposes the aboutLogo RPC");
const syncLib = readFileSync(new URL("../lib/workflow-skills-sync.mjs", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.files.includes("assets"), true, "plugin package carries assets for the RPC to read");

// A plugin release pins Stelow's helper and skills. Runtime must not mutate
// that evidence from upstream main, and About names the pinned version.
assert.match(syncLib, /readPinnedStelowSource/, "release sync reads a pinned source manifest");
assert.doesNotMatch(server, /syncHelperScript|syncWorkflowSkills|background\.schedule\("stelow-skills-sync"/, "runtime never mutates vendored Stelow behavior");
assert.match(server, /bb\.sdk\.plugins\.checkUpdates\(\{ pluginId: bb\.pluginId \}\)/, "BB owns the installed-plugin update check");
assert.match(server, /bb\.sdk\.plugins\.applyUpdate\(\{ pluginId: bb\.pluginId \}\)/, "BB owns the explicit update operation");
assert.match(server, /async buildInfo\(\) \{\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*await refreshPluginUpdate\(\);/, "each UI read obtains a fresh BB-owned update status");
assert.match(aboutUi, /skills · pinned to Stelow/, "About shows the pinned version, not an ambiguous sync age");
// Version story reads top-down across cards: Status (verdict + notices),
// then Contents (description with the skills pin beside the content it
// describes). A notice below the description would read as unrelated.
const aboutUpdateAt = aboutUi.indexOf("actions.error");
const aboutDescAt = aboutUi.indexOf("This plugin hosts Stelow inside bb");
assert.ok(aboutUpdateAt >= 0 && aboutDescAt >= 0 && aboutUpdateAt < aboutDescAt, "update notices sit with the update verdict, above the description");
const statusCardAt = aboutUi.indexOf(">Status</h3>");
const contentsCardAt = aboutUi.indexOf("What this plugin gives you");
assert.ok(statusCardAt >= 0 && contentsCardAt > statusCardAt, "the Status card precedes the Contents card");
const aboutPinAt = aboutUi.indexOf("pinned to Stelow {buildInfo.stelowVersion");
assert.ok(aboutPinAt > contentsCardAt, "the methodology pin reads inside Contents, beside the content it describes");
assert.match(aboutUi, /"Up to date"/, "the current verdict names no version — the heading beside it already does");
assert.match(aboutUi, /Update plugin…/, "About offers an explicit, confirmed plugin update");
assert.match(aboutUi, /APPLY_SETTLE_MS/, "applying timeboxes the quiet phase so “Updating…” can’t spin forever when the reload severs the RPC channel");
assert.match(aboutUi, /showing the last known verdict/, "a failed fresh check keeps the last verdict visible instead of erasing it");
assert.match(supportSidebar, /Stelow plugin update available/, "sidebar exposes a separate update indicator");
assert.match(aboutUi, /setSkillsOpen\(true\)/, "sync status opens the vendored-skills dialog");
assert.match(aboutUi, /Vendored Stelow skills/, "dialog names the vendored skill inventory");
assert.match(aboutUi, /Reinstall .* at its latest release/, "installed tools offer reinstall-as-update");
assert.match(aboutUi, /Ready via npx/, "npx-resolved dependencies are listed without probe or buttons");
assert.match(aboutUi, /last30days/, "social-signal skill is disclosed with its consent rule");
assert.match(aboutUi, /agent-reach/, "fetch-router skill is disclosed with its consent rule");
assert.match(aboutUi, /thermo-nuclear/, "nuclear review gate skill is disclosed");
assert.match(
  aboutUi,
  /name: "thermo-nuclear",\n\s+repo: "https:\/\/github\.com\/cursor\/plugins\/tree\/main\/cursor-team-kit\/skills\/thermo-nuclear-code-quality-review"/,
  "thermo-nuclear links the original skill, never an embedded copy",
);
assert.doesNotMatch(aboutUi, /npx skills add|npx @vedanth/, "About shows no runnable commands — workers resolve everything");
assert.doesNotMatch(aboutUi, /plannotator/, "About never references the bb-unused tool");
assert.doesNotMatch(server, /plannotator/, "server drops the bb-unused tool entirely");

console.log("about logo test ok: data URI delivery, budget, and no static-asset URLs");
