/**
 * Reading a card's scope map, once.
 *
 * Two callers need the same two facts and must agree on them: the advance gate
 * asks whether an approved map exists before a broad refactor enters execution,
 * and the detail projection asks for the approved map to draw the X-ray. Both
 * read `<state-dir>/scope-map.json`, both refuse a map that does not satisfy its
 * contract, and both treat an unapproved map as absent. Two readers would be two
 * chances for the gate and the projection to disagree about what "approved"
 * means, and a card that passes one and not the other is unexplainable.
 *
 * The parse and the contract check are pure; the read is the host's.
 */
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { validateScopeMap, type ScopeMap } from "../lib/scope-map.mjs";
import { buildScopeDraft, buildScopeXray, parseCurrentShapeVersion } from "../lib/scope-xray.mjs";
import { parseReceiptFile } from "../lib/decision-receipts.mjs";
import { summarizeDecisions } from "../lib/decision-xray.mjs";

const SCOPE_MAP_FILE = "scope-map.json";
const SCOPE_DRAFT_FILE = "scope-map-draft.json";
const STATE_FILE = "state.md";

/** The X-ray the card draws: the approved map, plus how fresh it is. */
export type ScopeXray = ReturnType<typeof buildScopeXray> & {
  /** Header-level decisions line; absent when the card holds no receipts. */
  decisions?: { live: number; stale: number; unknown: number; conflicts: Array<{ a: string; b: string; scopeIds: string[] }> } | null;
};

/** The draft preview for the gate review: same graph, explicitly not approved. */
export type ScopeDraft = ReturnType<typeof buildScopeDraft>;

/** The parsed map, or null when it is missing, unparseable, or off-contract. */
export function parseScopeMapFile(content: string): ScopeMap | null {
  try {
    const map = JSON.parse(content) as unknown;
    return validateScopeMap(map).length === 0 ? map as ScopeMap : null;
  } catch {
    return null;
  }
}

/** An off-contract map is not a map; an unapproved one is a map nobody signed. */
export function isApprovedScopeMap(map: ScopeMap | null): map is ScopeMap {
  return map !== null && map.status === "approved";
}

export type ScopeMapReader = {
  /** The card's contract-valid map, whatever its approval state. */
  readScopeMap: (stateDir: string | null) => Promise<ScopeMap | null>;
  /** True only for a contract-valid map carrying an approval. */
  scopeMapApproved: (stateDir: string | null) => Promise<boolean>;
  /** The approved map drawn as a graph; null when there is none to draw. */
  scopeXray: (stateDir: string | null) => Promise<ScopeXray | null>;
  /** The draft preview drawn as a graph; null when absent or superseded by an approved map. */
  scopeDraft: (stateDir: string | null) => Promise<ScopeDraft | null>;
};

/** Header-level decisions line, best-effort: an unreadable store draws no
 * sentence rather than breaking the map. */
async function readDecisionSummary(
  bb: Pick<BbPluginApi, "sdk">,
  stateDir: string,
  currentShapeVersion: string | null,
) {
  const file = await bb.sdk.files.read({ path: join(stateDir, "decision-receipts.json") })
    .catch(() => null);
  if (!file) return null;
  return summarizeDecisions(parseReceiptFile(file.content), { shapeVersion: currentShapeVersion ?? undefined });
}

export function createScopeMapReader(bb: Pick<BbPluginApi, "sdk">): ScopeMapReader {
  async function readScopeMap(stateDir: string | null): Promise<ScopeMap | null> {
    if (!stateDir) return null;
    const file = await bb.sdk.files.read({ path: join(stateDir, SCOPE_MAP_FILE) })
      .catch(() => null);
    return file ? parseScopeMapFile(file.content) : null;
  }
  async function scopeXray(stateDir: string | null): Promise<ScopeXray | null> {
    const map = await readScopeMap(stateDir);
    if (!isApprovedScopeMap(map) || !stateDir) return null;
    // Freshness is the card's own state version: a map written before the
    // current shape is drawn as stale rather than as truth.
    const state = await bb.sdk.files.read({ path: join(stateDir, STATE_FILE) })
      .then((file) => file.content)
      .catch(() => null);
    const currentShapeVersion = parseCurrentShapeVersion(state);
    const xray = buildScopeXray(map, { currentShapeVersion });
    // Decisions ride the same header, best-effort: an unreadable store draws
    // no sentence rather than breaking the map.
    const decisions = await readDecisionSummary(bb, stateDir, currentShapeVersion).catch(() => null);
    return decisions ? { ...xray, decisions } : xray;
  }
  async function scopeDraft(stateDir: string | null): Promise<ScopeDraft | null> {
    if (!stateDir) return null;
    // A draft never competes with an approved map: when the real map
    // exists, the preview has nothing to add and stays hidden.
    if (isApprovedScopeMap(await readScopeMap(stateDir))) return null;
    const file = await bb.sdk.files.read({ path: join(stateDir, SCOPE_DRAFT_FILE) })
      .catch(() => null);
    const map = file ? parseScopeMapFile(file.content) : null;
    if (!map || map.status === "approved") return null;
    const state = await bb.sdk.files.read({ path: join(stateDir, STATE_FILE) })
      .then((file) => file.content)
      .catch(() => null);
    try {
      return buildScopeDraft(map, { currentShapeVersion: parseCurrentShapeVersion(state) });
    } catch {
      return null;
    }
  }
  return {
    readScopeMap,
    scopeMapApproved: async (stateDir) => isApprovedScopeMap(await readScopeMap(stateDir)),
    scopeXray,
    scopeDraft,
  };
}
