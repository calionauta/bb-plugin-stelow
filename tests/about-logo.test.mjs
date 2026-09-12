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
assert.doesNotMatch(app, /new URL\("\.\/assets\//, "frontend never builds a runtime static-asset URL");
const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
assert.match(server, /aboutLogo:\s*\{/, "server exposes the aboutLogo RPC");
const syncLib = readFileSync(new URL("../lib/workflow-skills-sync.mjs", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.files.includes("assets"), true, "plugin package carries assets for the RPC to read");

// buildInfo carries the upstream-skills verification timestamp and the
// About tab renders it next to the plugin version.
assert.match(server, /skillsSyncedAt: z\.number\(\)\.nullable\(\)/, "buildInfo exposes the skills verification timestamp");
assert.match(server, /skillsSyncedAt: readLastSyncAt\(SYNC_STATE_FILE\)/, "verification timestamp is read live, not memoized");
assert.match(syncLib, /if \(result\.errors\.length === 0\) (nextState|state)\[SYNC_TIMESTAMP_KEY\] = Date\.now\(\);/, "only clean verifications advance the timestamp");
assert.match(app, /skills · synced /, "About shows a compact sync status, not a noisy paragraph");
assert.match(app, /setSkillsOpen\(true\)/, "sync status opens the vendored-skills dialog");
assert.match(app, /Vendored Stelow skills/, "dialog names the vendored skill inventory");
assert.match(app, /Reinstall .* at its latest release/, "installed tools offer reinstall-as-update");
assert.match(app, /Ready via npx/, "npx-resolved dependencies are listed without probe or buttons");
assert.match(app, /last30days/, "social-signal skill is disclosed with its consent rule");
assert.doesNotMatch(app, /plannotator/, "About never references the bb-unused tool");
assert.doesNotMatch(server, /plannotator/, "server drops the bb-unused tool entirely");

console.log("about logo test ok: data URI delivery, budget, and no static-asset URLs");
