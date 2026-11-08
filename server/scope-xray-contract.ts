import { z } from "zod";

// Node/edge shapes shared by the approved X-ray and the draft preview.
// One home so the two contracts can never drift apart; the draft adds
// exactly one marker (`draft: true`) and nothing else.
const scopeXrayNodes = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    capabilities: z.array(z.string()),
    state: z.enum(["current", "stale", "blocked", "unknown"]),
    provenance: z.array(z.string()),
  }),
);
const scopeXrayEdges = z.array(
  z.object({
    from: z.string(),
    to: z.string(),
    kind: z.literal("depends-on"),
    state: z.enum(["current", "stale", "blocked", "unknown"]),
    provenance: z.array(z.string()),
  }),
);

function scopeXrayBase() {
  return {
    source: z.literal("server-projection"),
    mutable: z.literal(false),
    mapId: z.string(),
    mapVersion: z.string(),
    freshness: z.enum(["current", "stale", "unknown"]),
    nodes: scopeXrayNodes,
    edges: scopeXrayEdges,
    // Header-level decisions line; absent on cards with no receipts, so old
    // projections stay valid and the sentence never invents content.
    decisions: z.object({
      live: z.number(),
      stale: z.number(),
      unknown: z.number(),
      conflicts: z.array(z.object({ a: z.string(), b: z.string(), scopeIds: z.array(z.string()) })),
    }).nullable().optional(),
  };
}

// The approved scope map, drawn as a graph. A server projection and nothing
// the card can write: the X-ray reports the map, the worker owns the map.
// Null on a card with no approved map to draw.
export const scopeXraySchema = z.object(scopeXrayBase());

// The draft map preview for the gate review. Present only when no approved
// map exists, so a draft never competes with the real map.
export const scopeDraftSchema = z.object({ ...scopeXrayBase(), draft: z.literal(true) });
