import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accessoryTone, activeCardCount } from "../lib/app-support-state.mjs";

const cards = [
  { id: "pending", status: "pending" },
  { id: "running", status: "in-progress" },
  { id: "done", status: "completed" },
  { id: "archived", status: "archived" },
];
assert.equal(activeCardCount(cards), 2, "sidebar counts unresolved cards only");
assert.equal(activeCardCount([]), 0, "an empty board has no active cards");
assert.equal(
  accessoryTone(2, "active-tone"),
  "active-tone",
  "a nonzero accessory count uses the track's attention tone",
);
assert.equal(
  accessoryTone(0, "active-tone"),
  "bg-muted text-muted-foreground",
  "an empty accessory uses the quiet tone",
);

const app = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
for (const helper of [
  "goToTrack",
  "goToCard",
  "usePluginUpdateSignal",
  "useBuildAccessory",
  "useResearchAccessory",
  "renderTrackPanel",
  "renderCardRoute",
]) {
  assert.doesNotMatch(app, new RegExp(`function ${helper}\\b`), `${helper} is owned by an app-support module`);
}
assert.match(app, /StelowPanelRoute/, "the app entry mounts the extracted panel route");
assert.match(app, /StelowInboxSidebarAccessory/, "the app entry mounts the extracted sidebar accessory");

console.log("app support helpers test ok: counts, ownership, and shell wiring");
