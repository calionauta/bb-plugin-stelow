/**
 * About logo delivery. bb's frontend builder has no image loader
 * (`import "./x.png"` fails the build) and managed installs serve only the
 * built app.js/app.css — so a runtime `./assets/*.png` URL (via `new URL`)
 * always 404s outside a local checkout. The logo therefore travels as a
 * data URI over RPC, read from the plugin source root, which exists in
 * every install layout (path, git, npm). Fetched lazily by the About tab,
 * so the board bundles never pay for it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ABOUT_LOGO_FILE = ["assets", "stelow-logo.png"];

// Displayed at most 256px wide; 512px source keeps retina crisp. The test
// budget (not the runtime) enforces this — a bigger asset must never
// silently hide the logo, it must fail loudly in CI instead.
export const ABOUT_LOGO_BUDGET_BYTES = 220 * 1024;

export function resolveAboutLogoPath(pluginRoot) {
  if (typeof pluginRoot !== "string" || pluginRoot.length === 0) return null;
  return join(pluginRoot, ...ABOUT_LOGO_FILE);
}

export function toLogoDataUri(bytes) {
  if (!bytes || bytes.length === 0) return null;
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

export function loadAboutLogo(pluginRoot, readFile = readFileSync) {
  try {
    const path = resolveAboutLogoPath(pluginRoot);
    if (!path) return null;
    return toLogoDataUri(readFile(path));
  } catch {
    return null;
  }
}
