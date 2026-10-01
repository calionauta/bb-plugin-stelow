// The unowned-card fixture, shared.
//
// A card is "unowned" when its state file names somebody other than the card the
// tracking file claims it belongs to. That disagreement is the whole premise of
// the refusal under test, so it cannot be faked with a dep returning null: the
// resolver, the seeder and the card row have to disagree for real, on disk, the
// way they do after a reseeded directory is reused. Everything here is therefore
// a real temp workspace and a host that answers from it.
//
// It lives apart from the suite because the suite is about one question (does
// the door open) and the fixture is about three kinds of plumbing — the card
// row, the fake host, and the seed/preset protocols — that would otherwise bury
// it.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STATE_TEMPLATE } from "../../lib/state-template.mjs";
import { OWNERSHIP_UNVERIFIED } from "../../lib/ownership-refusal.mjs";

export const CARD_ID = "card_unowned";
export const STALE_DIR_HASH = "sw-card_unowned";
const STATE_REL = ".stelow/2026-09-16/sw-card_unowned";

const stateFor = (owner) =>
  STATE_TEMPLATE.replace("<workflow-id>", owner)
    .replace("<workflow-name>", "unowned card")
    .replace("<new-product|feature|bugfix|refactor|investigate|unknown>", "feature");

/** A card row in the state the refusal describes: errored, and its error IS the refusal. */
export function card(overrides = {}) {
  return {
    id: CARD_ID,
    project_id: "project_1",
    name: "unowned card",
    display_name: "Unowned card",
    prompt: "Build it",
    intent: "feature",
    status: "in-progress",
    stage: "planning",
    activity: "error",
    worker_thread_id: "thread_old",
    worker_preset_id: "preset_1",
    preset_restart_pending: 0,
    dir_hash: STALE_DIR_HASH,
    auto_continue_count: 0,
    auto_continue_stage: null,
    attachments: "[]",
    workspace_kind: "project",
    research_strategy: null,
    research_strategies: null,
    explore_stage: null,
    last_error: OWNERSHIP_UNVERIFIED,
    last_assistant_text: null,
    kind: "build",
    ...overrides,
  };
}

/** The host's file reads, answered from the real workspace on disk. */
export function host(root) {
  return {
    sdk: {
      files: {
        read: async ({ path }) => ({ content: readFileSync(path, "utf8") }),
      },
    },
    realtime: { publish: () => undefined },
  };
}

/**
 * A workspace whose two ownership records disagree: the tracking file claims
 * this card, and the state file inside that very directory names somebody else.
 * Nothing about the card row is wrong — only the records, which is exactly why
 * no other repair is honest and why only a reseed can fix it.
 */
export function unownedWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "stelow-unowned-door-"));
  const stateDir = join(root, STATE_REL);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "state.md"), stateFor("card_somebody_else"));
  writeFileSync(
    join(root, "stelow.json"),
    JSON.stringify({
      workflows: [{
        workflowId: CARD_ID,
        name: "unowned card",
        dirHash: STALE_DIR_HASH,
        created: "2026-09-16T10:00:00.000Z",
        stage: { current_stage: "planning" },
      }],
    }, null, 2),
  );
  return { root, bb: host(root) };
}

export function preset() {
  return {
    id: "preset_1",
    name: "preset",
    provider_id: "provider",
    model_id: "model",
    reasoning_level: "medium",
    permission_mode: "ask",
    environment_kind: "project",
    base_branch: null,
    machine_id: null,
    instructions: "",
  };
}

export const protocols = {
  cardOwnerRules: "owner",
  neverSeed: "never",
  cliEquivalents: "cli",
  reconProtocol: "recon",
  draftProtocol: "draft",
  turnDiscipline: "turn",
  commitStyle: "commit",
  interfacePick: "interface",
  doneProtocol: "done",
  splitProtocol: "split",
};

export const errors = {
  cardNotFound: "card not found",
  cardArchived: "archived",
  workspaceUnavailable: "workspace unavailable",
  presetNotFound: "preset not found",
};
