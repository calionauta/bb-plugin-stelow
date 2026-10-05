// The door the refusal names, proved open on the card that is refused.
//
// `lib/ownership-refusal.mjs` tells the reader that an unowned card is cleared
// by Restart fresh…, and `tests/ownership-refusal.test.mjs` used to prove that
// by asserting the sentence CONTAINS the words "Restart fresh". That is a pin on
// a string, not on a door: it passes unchanged if the reseed path grows a
// `requireOwnedState` guard, which is the exact shape of change that would turn
// the sentence into a lie. A refusal that names a door nobody can open is a
// deadlock with a good error message, and this suite is the one that notices.
//
// So this runs the REAL reseed — real `seedWorkflow`, real `resolveWorkflowState
// Dir`, a real workspace on disk whose records genuinely disagree — and asks the
// only question that matters: after the action the sentence names, do the
// records agree? An unowned card is a card whose state file names somebody else;
// a repair that leaves it that way has not opened anything.
//
// The second half closes the other direction. The surface has to OFFER the
// action: a refusal naming an entry the menu does not render sends the reader
// looking for a door that is not there, and that is asserted against the policy
// function that decides it rather than against the words in the menu.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { createCardReseed } from "../server/runtime/card-reseed.ts";
import { seedWorkflow } from "../server/runtime/workflow-seeding.ts";
import { resolveWorkflowStateDir } from "../server/runtime/workflow-state.ts";
import { isOwnershipRefusal, OWNERSHIP_UNVERIFIED } from "../lib/ownership-refusal.mjs";
import { workerActionPolicy } from "../lib/worker-action-policy.mjs";
import {
  card,
  CARD_ID,
  errors,
  preset,
  protocols,
  unownedWorkspace,
} from "./helpers/unowned-card-fixture.mjs";

/** The deps that make the reseed a RECORDER, so a test can pin what it did. */
function recordingDeps(calls) {
  return {
    now: () => 1_700_000_000_000,
    db: { prepare: (sql) => ({ run: (...args) => calls.push(["run", sql, ...args]) }) },
    getCard: () => card(),
    resetAutoContinue: () => ({ count: 0, stage: null }),
    updateCard: (...args) => calls.push(["update", ...args]),
    recordThread: (...args) => calls.push(["record", ...args]),
    publishCard: (...args) => calls.push(["publish", ...args]),
  };
}

/** The deps that answer the WORKSPACE, wired to the real seeder and resolver. */
function workspaceDeps(root, bb, calls, stateConfig = null) {
  return {
    ...recordingDeps(calls),
    bb,
    cardWorkspace: async () => ({ path: root, hostId: "host_1" }),
    // The real resolver, so the verdict that opens this suite is the same one
    // the card's own error chip was written from.
    workflowStateDir: async (_rootPath, row) => {
      const verdict = await resolveWorkflowStateDir(bb, root, row.id, row.dir_hash);
      calls.push(["resolve", verdict.kind]);
      return verdict.kind === "resolved" ? verdict.path : null;
    },
    readStateConfig: async () => stateConfig,
    seedWorkflow: (args) => {
      calls.push(["seed", args.intent, args.knobs]);
      return seedWorkflow(
        bb,
        root,
        args.card.id,
        args.card.name,
        args.intent,
        args.appetite,
        args.reviewGates,
        true,
      );
    },
  };
}

/** The deps that describe the WORKER: a preset, prompts, and a spawn recorder. */
function workerDeps(calls) {
  return {
    getPresetById: () => preset(),
    pinCardPreset: () => true,
    getReliablePreset: () => preset(),
    presetParams: (value) => ({
      providerId: value.provider_id,
      modelId: value.model_id,
      reasoningLevel: value.reasoning_level,
      permissionMode: value.permission_mode,
      environmentKind: value.environment_kind,
      baseBranch: value.base_branch,
      machineId: value.machine_id,
      instructions: value.instructions,
    }),
    strategyList: () => [],
    strategyRounds: () => [],
    roundFile: () => "round.md",
    roundStamp: () => "stamp",
    roundRelativePath: (_state, _root, file) => file,
    ensureArtifactParent: async () => undefined,
    researchPrompt: () => "research",
    explorePrompt: () => "explore",
    attachments: () => [],
    continuingEnvironment: async (_row, environment) => environment,
    workerEnvironment: () => ({ type: "host" }),
    replacePrepared: async (args) => {
      calls.push(["replace", args.input[0].text]);
      return { id: "thread_new" };
    },
    lineage: async (...args) => calls.push(["lineage", ...args]),
    protocols,
    errors,
  };
}

const { root, bb } = unownedWorkspace();
try {
  const before = await resolveWorkflowStateDir(bb, root, CARD_ID, card().dir_hash);
  assert.equal(before.kind, "unowned", "the fixture really is a card whose records disagree");

  const calls = [];
  const reseed = createCardReseed({
    ...workspaceDeps(root, bb, calls),
    ...workerDeps(calls),
  });
  const result = await reseed({ cardId: CARD_ID });

  // The door, asked as a question: does the action the sentence names succeed on
  // the card the sentence is written for? A `requireOwnedState` guard added to
  // this RPC, or a seed that stopped minting a fresh generation, fails here.
  assert.equal(result.error, null, `Restart fresh must open on an unowned card: ${result.error}`);
  assert.equal(result.reseeded, true, "the reader's action is not a refusal");

  // And it must leave the card owned, not merely claim to. The resolver is the
  // one that produced the verdict, so this cannot pass by agreeing with a lie.
  const dirHashWrite = calls.find(
    ([name, sql]) => name === "run" && sql.includes("dir_hash"),
  );
  assert.ok(dirHashWrite, "the repair records the generation it created");
  const after = await resolveWorkflowStateDir(bb, root, CARD_ID, dirHashWrite[2]);
  assert.equal(
    after.kind,
    "resolved",
    "after the action the refusal names, the records agree — a repair that leaves them disagreeing has opened nothing",
  );
  assert.equal(
    isOwnershipRefusal(result.error ?? ""),
    false,
    "a card that reseeded must not be left carrying the refusal",
  );

  // The surface must OFFER the action it is told to take. A card whose error IS
  // the refusal is in the error state, and the menu policy — not the copy in
  // the menu — decides whether Restart fresh is rendered.
  const refused = card();
  assert.equal(
    isOwnershipRefusal(refused.last_error),
    true,
    "the card's own error is the refusal, so the special advice applies to it",
  );
  assert.equal(
    workerActionPolicy(refused, true).showRestartFresh,
    true,
    "the surface offers the action the refusal names; a reader sent to a missing entry is stuck",
  );
  // A non-Build card is the one case where the menu legitimately hides it, and
  // hiding it is correct there — so this asserts the policy is discriminating,
  // not that it always says yes.
  assert.equal(
    workerActionPolicy({ ...refused, status: "archived" }, true).showRestartFresh,
    false,
    "archived is terminal and the menu is not a resurrection",
  );

  // An explicit red_first survives Restart fresh: the reseed rebuilds knobs
  // from the prior state's config, and dropping the mode would silently
  // re-stricten a card the reader set to off. The seed call is the recorder —
  // the knobs it carries are what the fresh state is written from.
  const redCalls = [];
  const redReseed = createCardReseed({
    ...workspaceDeps(root, bb, redCalls, {
      quality: "production",
      supervisor: "high",
      explorationCount: 3,
      explorationHybrid: true,
      redFirst: "off",
      reviewGates: [],
    }),
    ...workerDeps(redCalls),
  });
  const redResult = await redReseed({ cardId: CARD_ID });
  assert.equal(redResult.error, null, `reseed stays open: ${redResult.error}`);
  const seedCall = redCalls.find(([name]) => name === "seed");
  assert.ok(seedCall, "the reseed seeds");
  assert.equal(seedCall[2]?.redFirst, "off", "the explicit red_first rides along to the fresh seed");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("reseed door ok: Restart fresh opens on an unowned card, and the menu offers it");
