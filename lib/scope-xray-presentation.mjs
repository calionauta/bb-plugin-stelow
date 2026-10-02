import { trackableStatusLabel } from "./trackables.mjs";

// What the Scope X-ray says, in words a reader can act on.
//
// The X-ray projects the APPROVED scope map. It is a different thing from the
// execution tracker, and the card used to print both while calling them the
// same word: the X-ray listed seven approved scopes, and four lines below it
// said "No scopes broken down yet — the agent is still shaping the card". Both
// were true, because one read `<stateDir>/scope-map.json` and the other read
// `stelow.json` plus the latest spec — and neither was the condition for the
// other's empty state.
//
// The raw enum made it worse. `current` is a STALENESS value from the map
// contract (lib/scope-map.mjs), not a progress state, and it was printed
// verbatim next to a scope id — so "env-seed-mapper · current" read as "this is
// the scope being worked on". It was also printed nine times: once in the
// header as freshness and once per node, from the same variable. One fact, two
// registers, and the most-repeated fact on the card was the one nobody asked
// for.
//
// So: the header carries the freshness, once, in a sentence; a node carries a
// label only when it DEVIATES from the map's own baseline; and the empty state
// is keyed on whether a map exists, not on whether the tracker is populated.

/**
 * The map's own baseline for a node: what a scope reads as when the map has
 * nothing to say about it individually.
 *
 * A stale map makes every node stale, whatever the node claims — the map as a
 * whole predates the card's current shape, so no individual entry can be
 * trusted either. That override is in `buildScopeXray`; repeating it here
 * would be a second copy of the same rule.
 */
function baseline(freshness) {
  return freshness === "stale" ? "stale" : "current";
}

/** How the whole map reads, as one phrase, said once. */
const FRESHNESS = {
  current: {
    label: "In sync",
    tone: "muted",
    note: "The approved map still matches the card's current shape.",
  },
  stale: {
    label: "Out of date",
    tone: "warn",
    note: "The shape moved on after this map was approved, so every scope in it is a starting point rather than a contract.",
  },
  unknown: {
    label: "Freshness unknown",
    tone: "muted",
    note: "The card's shape version could not be read, so nothing here can say whether the map is current.",
  },
};

/** How one scope reads, when it reads anything at all. */
// A row's own state, and it is two axes — which is the point of listing the
// sources rather than the words. `blocked` is a TRACKABLE status, so its label
// comes from the trackable machine and stays in step with it: a scope blocked in
// the scopes list and a node blocked in the X-ray must not drift into two
// spellings of the same state. `stale` and `unknown` are freshness values from
// the map contract, not pendency statuses, so they are named here — a freshness
// value has no business in the trackable vocabulary.
const NODE_STATE = {
  blocked: { label: trackableStatusLabel("blocked"), tone: "warn" },
  stale: { label: "Predates the current shape", tone: "warn" },
  unknown: { label: "Not classified", tone: "muted" },
};

/**
 * The X-ray as the card draws it.
 *
 * `nodes` keep only what is worth a reader's eye: the deviation, if any. A node
 * that agrees with the map's baseline is silent, because "in sync" on all
 * seven lines is the header's job done seven more times.
 */
export function scopeXrayPresentation(xray) {
  if (!xray || !Array.isArray(xray.nodes)) return null;
  const freshness = FRESHNESS[xray.freshness] ?? FRESHNESS.unknown;
  const floor = baseline(xray.freshness);
  return {
    mapId: xray.mapId,
    mapVersion: xray.mapVersion,
    scopeCount: xray.nodes.length,
    freshness: {
      ...freshness,
      // A stale map is the one state where the deviation is on every line, and
      // saying it per node would be the nine-times problem again. So the stale
      // fact is the header's, and nodes stay quiet about it.
      appliesToAll: floor === "stale",
    },
    nodes: xray.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      capabilities: Array.isArray(node.capabilities) ? node.capabilities : [],
      state: nodeState(node.state, floor),
    })),
    dependencies: (Array.isArray(xray.edges) ? xray.edges : []).map((edge) => ({
      from: edge.from,
      to: edge.to,
    })),
  };
}

/** Null when the node agrees with the map's baseline — nothing to say. */
function nodeState(state, floor) {
  if (state === floor) return null;
  return NODE_STATE[state] ?? null;
}

/**
 * Why the card has no tracked scopes — which is a different question depending
 * on whether an approved map exists.
 *
 * The map and the tracker are separate: the map is written at the `scope`
 * stage, the tracker appears at `execution`. A card can hold an approved map
 * with nothing tracked yet, and calling that "no scopes broken down yet" told
 * a reader the shaping had not happened when it had.
 */
export function scopeEmptyState({ hasMap, tracked, cardStatus, archived }) {
  if (archived) return archived;
  if (tracked > 0) return null;
  if (hasMap) {
    return "The map above is approved. Scopes are tracked here once execution starts — nothing is missing in the meantime.";
  }
  if (cardStatus === "completed") {
    return "Completed without scoped execution — no scope was ever tracked (pre-guard format). "
      + "Verify the work through the audit record and files below; reopen an earlier stage to "
      + "continue it under tracking.";
  }
  return "No scope map yet — the agent is still shaping the card.";
}
