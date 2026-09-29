import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accessoryTone, activeCardCount } from "../lib/app-support-state.mjs";

// The tab count has to match the board it labels. A card in the Bucket is
// counted on the Bucket's own header button, so counting it here showed the
// same card twice and made the tab disagree with the columns beside it.
const cards = [
  { id: "pending", kind: "build", status: "pending", stage: "triage", workerThreadId: null },
  { id: "running", kind: "build", status: "in-progress", stage: "execution", workerThreadId: "thr_1" },
  { id: "done", kind: "build", status: "completed", stage: "done", workerThreadId: "thr_2" },
  { id: "archived", kind: "build", status: "archived", stage: "done", workerThreadId: "thr_3" },
];
assert.equal(activeCardCount(cards), 2, "sidebar counts unresolved cards on the board only");
assert.equal(activeCardCount([]), 0, "an empty board has no active cards");
// Terminality is read off the column, so a terminal status is excluded for a
// reason that survives a new terminal outcome being added to the catalog: this
// pair of cards differ from the counted ones ONLY in status.
assert.equal(
  activeCardCount([
    { id: "done", kind: "build", status: "completed", stage: "done", workerThreadId: "thr_a" },
    { id: "archived", kind: "build", status: "archived", stage: "done", workerThreadId: "thr_b" },
  ]),
  0,
  "a completed or archived card is history, whatever its stage or worker",
);
assert.equal(
  activeCardCount([{ id: "parked", kind: "build", status: "draft", stage: "triage", workerThreadId: null }]),
  0,
  "a parked Bucket draft is not on a board column, so the tab does not count it",
);
assert.equal(
  activeCardCount([{ id: "parked", kind: "research", status: "pending" }]),
  0,
  "the lightweight Bucket parks on status, and a research card reads as Bucket the same way",
);
assert.equal(
  activeCardCount([{ id: "blocked", kind: "build", status: "blocked", stage: "execution", workerThreadId: "thr_4" }]),
  1,
  "a build card that is not in a terminal state nor parked stays counted, whatever its status",
);
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
