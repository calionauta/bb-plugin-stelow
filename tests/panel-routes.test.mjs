import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cardSubPath,
  inboxCardSubPath,
  parseStelowSubPath,
  trackOfCard,
  trackRootSubPath,
  trackTitle,
} from "../components/panel/stelow-route.mjs";

const track = (value) => ({ kind: "track", track: value });

for (const value of ["", "/", "///", "build", "/build/"]) {
  assert.deepEqual(parseStelowSubPath(value), track("build"), `build route: ${JSON.stringify(value)}`);
}
for (const value of ["inbox", "/research/", "explore", "/about/"]) {
  const expected = value.replaceAll("/", "");
  assert.deepEqual(parseStelowSubPath(value), track(expected), `track route: ${value}`);
}
for (const origin of ["inbox", "build", "research", "explore"]) {
  assert.deepEqual(
    parseStelowSubPath(`${origin}/card/card_abc123`),
    { kind: "card", cardId: "card_abc123", eventId: null, origin },
    `${origin} card without an event keeps the route answerable`,
  );
}
assert.deepEqual(
  parseStelowSubPath("research/card/card_abc123/event/evt_xyz789"),
  { kind: "card", cardId: "card_abc123", eventId: "evt_xyz789", origin: "research" },
  "a prefixed card preserves its event and return track",
);
assert.deepEqual(
  parseStelowSubPath("card/card_abc123"),
  { kind: "bare-card", cardId: "card_abc123", eventId: null },
  "a trackless card route remains supported",
);
assert.deepEqual(
  parseStelowSubPath("/card/card_abc123/event/evt_xyz789/"),
  { kind: "bare-card", cardId: "card_abc123", eventId: "evt_xyz789" },
  "padding around a trackless card route does not change its identity",
);
for (const value of [
  "unknown",
  "about/card/card_abc123",
  "build/card/not-a-card",
  "build/card/card_abc/event/not-an-event",
  "card/card_abc/event/evt_xyz/extra",
]) {
  assert.deepEqual(parseStelowSubPath(value), track("build"), `invalid path falls back safely: ${value}`);
}

const trackMetadata = [
  ["inbox", "Inbox", "inbox"],
  ["build", "Build", "build"],
  ["research", "Research", "research"],
  ["explore", "Explore", "explore"],
  ["about", "About", "about"],
];
for (const [key, title, root] of trackMetadata) {
  assert.equal(trackTitle(key), title, `${key} has one canonical title`);
  assert.equal(trackRootSubPath(key), root, `${key} has one canonical route root`);
}
for (const kind of ["build", "research", "explore"]) {
  assert.equal(trackOfCard({ kind }), kind, `${kind} cards stay on their source track`);
}
assert.equal(cardSubPath({ kind: "research" }, "card_abc123"), "research/card/card_abc123", "cards link under their track");
assert.equal(
  cardSubPath({ kind: "build" }, "card_abc123", "evt_xyz789"),
  "build/card/card_abc123/event/evt_xyz789",
  "card events are optional navigation targets",
);
assert.equal(inboxCardSubPath("card_abc123", "evt_xyz789"), "inbox/card/card_abc123/event/evt_xyz789", "inbox events always identify both ids");

// React has no mounted renderer in this repository. These wiring pins catch
// hidden keep-alive panels becoming active, which would restart subscriptions.
const panelSource = readFileSync(new URL("../components/panel/stelow-panel.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
assert.match(panelSource, /renderTrack\(track, track === tab\)/, "only the selected keep-alive track receives active=true");
assert.match(
  appSource,
  /<BuildPanel[\s\S]*?active=\{active\}/,
  "BuildPanel must forward the routed active state",
);
for (const component of ["ResearchPanel", "ExplorePanel"]) {
  assert.match(
    appSource,
    new RegExp(`<${component} active=\\{active\\} />`),
    `${component} must forward the routed active state`,
  );
}

console.log("panel routes test ok: tracks, cards, events, padding, active state, and safe fallback");
