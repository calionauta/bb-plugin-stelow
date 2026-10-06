/**
 * Every spawn path's prompt, rendered from one canonical fixture.
 *
 * There are five ways a build worker is told what to do, and until this helper
 * existed the suite rendered exactly one of them (`build-prompt-render`). The
 * other four were only ever checked by scanning source text for a token name,
 * which cannot see a token that renders empty and cannot see a clause that a
 * path skips entirely. That blind spot is not theoretical: the ask contract was
 * pasted five times and two paths lost its waiting-text guard.
 *
 * All five are pure functions of (context, rules), so the whole matrix renders
 * in well under a millisecond with no host, no database, and no spawn. A test
 * that needs nothing but this helper can afford to render all five on every
 * run, which is the point.
 */
import { buildBuildPrompt } from "../../server/cards-create-prompt.ts";
import { buildWorkerRestartPrompt } from "../../server/runtime/worker-restart-prompt.ts";
import { buildReseedPrompt } from "../../server/runtime/card-reseed-prompt.ts";
import { createTrackPrompts } from "../../server/runtime/track-prompts.ts";

/** The clauses every build worker prompt must carry, from the one bag that
 * owns them. Spelled out by import so a clause added to the bag is a clause a
 * test starts asserting, instead of a clause only the source happens to know. */
import { WORKER_PROTOCOL_CLAUSES } from "../../server/runtime/worker-protocol-clauses.ts";

/** Clauses required on every path whose worker can reach a gate.
 *
 * DERIVED from the bag, not listed by hand. The hand-written version was the same defect
 * as the fixtures that re-listed the bag: it went stale the moment a clause was added, so
 * `commandFailureRule`, `workflowIntro` and `workflowSkills` were never asserted owed —
 * and removing `%COMMAND_FAILURE_RULE%` from the template left the coverage test GREEN.
 * Deriving means a clause added to the bag is a clause every build path is immediately
 * held to, which is the property the whole bag exists for.
 */
export const BUILD_PATH_CLAUSES = Object.keys(WORKER_PROTOCOL_CLAUSES);

/** The clauses the TRACK prompts carry. They have no stages and no gates, so they get
 * the ask contract, the completion rule and the draft protocol rather than the whole
 * build bag — a difference declared here rather than discovered per test. */
export const TRACK_PATH_CLAUSES = ["userInputContract", "doneProtocol", "draftProtocol"];

/** The canonical card. One fixture for every path, so a difference between two
 * rendered prompts is a difference between the paths and never between two
 * test fixtures. */
export const CARD = {
  id: "card_probe",
  name: "add-scope-map",
  display_name: "Add read-only Scope Map view",
  kind: "build",
  status: "in-progress",
  intent: "feature",
  stage: "execution",
  prompt: "Add a read-only Scope Map view to an existing Build card.",
  worker_thread_id: "thr_previous",
};

const RULES = {
  // Spread, not re-listed. This fixture used to name all eleven clauses by hand, and
  // when the bag gained `workflowIntro` the fixture silently kept passing it as
  // undefined — so the intro rendered EMPTY and the spawn prompt opened with a blank
  // line. The registry guard did not catch it either, because it checks that a
  // fixture declares every clause it names, not that it names every clause there is.
  ...WORKER_PROTOCOL_CLAUSES,
};

const RESTART_PROTOCOLS = {
  // Spread, not re-listed: this fixture named every clause by hand and passed a new
  // one as undefined, so the restart prompt rendered the literal text `undefined`.
  ...WORKER_PROTOCOL_CLAUSES,
};
const TRACK_PROTOCOLS = {
  // The track prompts carry the narrower set their workers can act on, so this one
  // names its clauses deliberately rather than spreading the whole build bag.
  cardOwnerRules: RULES.cardOwnerRules,
  doneProtocol: RULES.doneProtocol,
  reviewProtocol: "REVIEW_PROTOCOL_SENTINEL",
  draftProtocol: RULES.draftProtocol,
  userInputContract: RULES.userInputContract,
};
const trackPrompts = createTrackPrompts(TRACK_PROTOCOLS);

/** The shared build context every build path renders from. One object, so a
 * difference between two rendered prompts is a difference between the paths and
 * never between two fixtures. */
const BUILD_CONTEXT = {
  stateDir: "/repo/.stelow/2026-10-05/sw-card_probe",
  intent: CARD.intent,
  managedWorktree: true,
  knobs: { quality: "production", supervisor: "high", explorationCount: 3, explorationHybrid: true },
  reviewGates: "[spec, interface, tech]",
  reviewRung: "Product Spec + Interface + Tech Review",
  instructions: "Preset instructions:\nstay narrow\n",
  prompt: CARD.prompt,
};

/** The reseed builder's input, unwrapped from the shared card. */
function reseedInput() {
  return {
    card: CARD,
    rootPath: "/repo",
    intent: CARD.intent,
    seed: { stateDir: BUILD_CONTEXT.stateDir },
    params: { instructions: "stay narrow" },
    protocols: RESTART_PROTOCOLS,
    research: null,
    explore: null,
    roundNo: 1,
    roundStamp: "2026-10-05",
    roundFile: "research-index.md",
    researchPrompt: trackPrompts.researchWorkerPrompt,
    explorePrompt: trackPrompts.exploreWorkerPrompt,
  };
}

/** The fields every track prompt shares. */
function trackShared() {
  return {
    displayName: CARD.display_name,
    prompt: CARD.prompt,
    stateDirText: BUILD_CONTEXT.stateDir,
    workspaceRoot: "/repo",
    instructions: "stay narrow",
    flavor: "initial",
    previousThreadId: CARD.worker_thread_id,
  };
}

/**
 * All five spawn paths, keyed by the name a failure should use.
 *
 * The three build paths carry the full protocol set; the two track prompts carry
 * the narrower set their workers can act on. Every path renders the same card
 * and the same instructions.
 */
export function renderSpawnPaths() {
  return {
    spawn: buildBuildPrompt(BUILD_CONTEXT, RULES),
    restart: buildWorkerRestartPrompt({
      card: CARD,
      instructions: "stay narrow",
      stateHint: BUILD_CONTEXT.stateDir,
      stateDir: BUILD_CONTEXT.stateDir,
      protocols: RESTART_PROTOCOLS,
    }),
    reseed: buildReseedPrompt(reseedInput()),
    research: trackPrompts.researchWorkerPrompt({
      ...trackShared(),
      strategyLabel: "Opportunity mapping",
      strategyId: "opportunity-mapping",
      strategySkill: "stelow-product-opportunity-mapping",
      roundNo: 1,
      roundStamp: "2026-10-05",
      roundFile: "research-index.md",
    }),
    explore: trackPrompts.exploreWorkerPrompt({
      ...trackShared(),
      stage: {
        id: "scope-map",
        label: "Scope Map",
        skill: "stelow-workflow-scope-map",
        primaryArtifact: "scope-map.json",
      },
    }),
  };
}


/** Which clause names each path owes, so a test asserts against the
 * declaration above rather than against its own copy. */
export const PATH_CONTRACTS = {
  spawn: BUILD_PATH_CLAUSES,
  restart: BUILD_PATH_CLAUSES,
  reseed: BUILD_PATH_CLAUSES,
  research: TRACK_PATH_CLAUSES,
  explore: TRACK_PATH_CLAUSES,
};

/** The clause texts, keyed as the bag names them, for presence checks that look
 * at prose rather than at a token. */
export function clauseTexts() {
  return { ...WORKER_PROTOCOL_CLAUSES };
}
