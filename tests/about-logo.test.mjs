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

console.log("about logo test ok: data URI delivery and asset budget");
