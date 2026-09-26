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
import { buildScopeXray, parseCurrentShapeVersion } from "../lib/scope-xray.mjs";

const SCOPE_MAP_FILE = "scope-map.json";
const STATE_FILE = "state.md";

/** The X-ray the card draws: the approved map, plus how fresh it is. */
export type ScopeXray = ReturnType<typeof buildScopeXray>;

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
};

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
    return buildScopeXray(map, { currentShapeVersion: parseCurrentShapeVersion(state) });
  }
  return {
    readScopeMap,
    scopeMapApproved: async (stateDir) => isApprovedScopeMap(await readScopeMap(stateDir)),
    scopeXray,
  };
}
