import { createResearchTrackHandlers } from "../../server/runtime/research-track-handlers.ts";

/** A research card's index as a worker writes it: unchecked boxes are
 * claimable, checked ones were already fanned out. The parser keeps the
 * "— why" tail in the title and slug, so the ids below are the real ones. */
export const INDEX = [
  "## Summary",
  "Short brief.",
  "",
  "## Opportunities",
  "### Business models — 2026-01-01",
  "- [ ] Second marketplace launch — demand is thin",
  "- [x] Legacy pricing cleanup — already shipped",
  "- [ ] Retain pricing experiment — churn is high",
  "- [ ] Checkout funnel teardown — leaks at the last step",
  "",
  "## Notes",
  "trailing text",
].join("\n");

export const NOT_AN_INDEX = "## Summary\nJust prose, no opportunity block.\n";

/** Ids the parser produces for the INDEX fixture, so a test never guesses. */
export const OPPORTUNITY = {
  marketplace: "second-marketplace-launch-demand-is-thin-1",
  legacy: "legacy-pricing-cleanup-already-shipped-2",
  retain: "retain-pricing-experiment-churn-is-high-3",
  checkout: "checkout-funnel-teardown-leaks-at-the-last-step-4",
};

export const ERRORS = {
  cardNotFound: "Card not found.",
  cardArchived: "Card is archived.",
};

export const NOW = 1_700_000_000_000;

export function researchCard(overrides = {}) {
  return {
    id: "card_r1",
    name: "pricing",
    display_name: "Pricing research",
    kind: "research",
    status: "in-progress",
    activity: "idle",
    project_id: "proj_1",
    workspace_kind: "project",
    dir_hash: "hash1",
    research_strategy: "business-models",
    ...overrides,
  };
}

function fakeDb(calls) {
  return {
    prepare(sql) {
      return {
        run(...values) {
          calls.push(["write", sql, values]);
        },
      };
    },
  };
}

function fakeBb(calls, writeFile) {
  return {
    realtime: { publish: (...args) => calls.push(["publish", ...args]) },
    sdk: {
      files: {
        write: async (payload) => {
          calls.push(["writeFile", payload]);
          if (writeFile) await writeFile(payload);
        },
      },
    },
  };
}

function fakeIndex(calls, index, indexOk) {
  return async () => {
    // Recorded so a guard that must run BEFORE the index read is observable:
    // a retired or wrong-track card must never touch the workspace.
    calls.push(["readIndex"]);
    return indexOk
      ? {
          ok: true,
          content: index,
          absolute: "/w/research-index.md",
          display: "research-index.md",
        }
      : { ok: false, error: "No workspace for this card." };
  };
}

function defaultCreateCard(calls) {
  return async (input) => {
    calls.push(["createCard", input]);
    return { cardId: `card_new_${calls.length}`, threadId: null };
  };
}

/** Every dep the index read and the card factories need. */
function readDeps(calls, o) {
  return {
    db: fakeDb(calls),
    bb: fakeBb(calls, o.writeFile),
    now: () => NOW,
    getCard: (id) => (id === o.card.id ? o.card : undefined),
    cardWorkspace: async () => ({ path: "/w", hostId: "host1" }),
    createCard: o.createCard,
    readResearchIndex: fakeIndex(calls, o.index, o.indexOk),
    roundRelPath: (_stateDir, _workspace, base) => `rounds/${base}`,
    logCardComment: (...args) => {
      calls.push(["comment", ...args]);
      return "cmt_1";
    },
    errors: { ...ERRORS },
  };
}

/** Every dep a strategy round needs: workspace-scoped files, the reliable
 * preset, and the respawn seam. */
function roundDeps(calls, o) {
  return {
    researchRoundFiles: async (path, hostId, stateDir, history, live) => {
      calls.push(["rounds", path, hostId, stateDir, history, live]);
      return { rounds: o.roundFiles };
    },
    strategyRounds: () => o.strategyRounds,
    strategyList: () => o.strategyList,
    workflowStateDir: async (root, workflowId) => {
      calls.push(["stateDir", root, workflowId]);
      return `${root}/.stelow/${workflowId}`;
    },
    ensureParent: async (workspace, rel) => calls.push(["mkdir", workspace, rel]),
    reliablePreset: () => ({ id: "preset_reliable" }),
    presetName: o.presetName,
    respawn: o.respawn,
  };
}

function resolveOptions(calls, options) {
  return {
    card: researchCard(),
    index: INDEX,
    indexOk: true,
    createCard: defaultCreateCard(calls),
    strategyList: ["business-models"],
    strategyRounds: [],
    roundFiles: [],
    presetName: (id) => (id === "preset_reliable" ? "Reliable preset" : undefined),
    ...options,
    respawn:
      options.respawn ??
      (async (...args) => {
        calls.push(["respawn", ...args]);
        return { ok: true };
      }),
  };
}

/** Wiring harness mirroring the composition root: every slice shares one deps
 * object, so a test exercises the same contract the RPC layer binds. */
export function harness(options = {}) {
  const calls = [];
  const resolved = resolveOptions(calls, options);
  const deps = { ...readDeps(calls, resolved), ...roundDeps(calls, resolved) };
  return { calls, handlers: createResearchTrackHandlers(deps), deps };
}

export function comments(calls) {
  return calls.filter(([name]) => name === "comment").map(([, , , , , body]) => body);
}

export function callsNamed(calls, name) {
  return calls.filter(([entry]) => entry === name);
}

export function firstCall(calls, name) {
  return calls.find(([entry]) => entry === name);
}
