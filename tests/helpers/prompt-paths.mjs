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
 *
 * Two cards, not one. `renderSpawnPaths()` renders the canonical card; the
 * cache measurements need a SECOND card, because the question they answer is
 * what two different spawns share. `renderSpawnPairs()` returns both, and the
 * only differences between them are values that differ between real cards:
 * state dir, card name, request, the research strategy, and the explore stage.
 */
import { buildBuildPrompt } from "../../server/cards-create-prompt.ts";
import { buildWorkerRestartPrompt } from "../../server/runtime/worker-restart-prompt.ts";
import { buildReseedPrompt } from "../../server/runtime/card-reseed-prompt.ts";
import { createTrackPrompts } from "../../server/runtime/track-prompts.ts";

/** The clauses every build worker prompt must carry, from the one bag that
 * owns them. Spelled out by import so a clause added to the bag is a clause a
 * test starts asserting, instead of a clause only the source happens to know. */
import { WORKER_PROTOCOL_CLAUSES } from "../../server/runtime/worker-protocol-clauses.ts";
import { TRACK_PROTOCOL_CLAUSES } from "../../server/runtime/track-protocol-clauses.ts";

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

/** The clauses the TRACK prompts carry, derived from their own bag for the same
 * reason. The two bags differ on purpose: a track has no stages and no gates,
 * and it owes the track half of the completion rule rather than the build
 * payload — a difference declared in the bag, not discovered per test. */
export const TRACK_PATH_CLAUSES = Object.keys(TRACK_PROTOCOL_CLAUSES);

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

/** The second card, used only to measure what two spawns share. Every field a
 * real second card would differ in differs here: the id (and therefore the
 * state dir), the name, the request, the research strategy, and the explore
 * stage. A pair that differed in nothing would measure a prefix of 100% and
 * prove nothing. */
export const OTHER_CARD = {
  id: "card_other",
  name: "fix-login-redirect",
  display_name: "Fix the login redirect loop",
  kind: "build",
  status: "in-progress",
  intent: "bugfix",
  stage: "execution",
  prompt: "Fix the login redirect loop that starts after a token refresh.",
  worker_thread_id: "thr_other_previous",
};

/** The research strategy the canonical card is on. */
const STRATEGY = {
  strategyLabel: "Opportunity mapping",
  strategyId: "opportunity-mapping",
  strategySkill: "stelow-product-opportunity-mapping",
};

/** Another strategy, so the research pair differs the way two real research
 * cards differ. */
const OTHER_STRATEGY = {
  strategyLabel: "Jobs to be done",
  strategyId: "jobs-to-be-done",
  strategySkill: "stelow-product-job-to-be-done",
};

/** The explore stage the canonical card is on. */
const STAGE = {
  id: "scope-map",
  label: "Scope Map",
  skill: "stelow-workflow-scope-map",
  primaryArtifact: "scope-map.json",
};

/** Another stage, for the same reason. */
const OTHER_STAGE = {
  id: "interface-contrast",
  label: "Interface Contrast",
  skill: "stelow-workflow-interface-contrast",
  primaryArtifact: "interface-contrast.md",
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
  // The track prompts carry their own bag, which is narrower than the build one
  // and carries the TRACK half of the completion rule. Spread from the bag so a
  // clause added there is a clause these fixtures render.
  ...TRACK_PROTOCOL_CLAUSES,
};
const trackPrompts = createTrackPrompts(TRACK_PROTOCOLS);

/** The state dir a card owns, derived from its id so the two cards cannot
 * accidentally share one. */
function stateDirOf(card) {
  return `/repo/.stelow/2026-10-05/sw-${card.id}`;
}

/** The shared build context every build path renders from. One object, so a
 * difference between two rendered prompts is a difference between the paths and
 * never between two fixtures. */
function buildContext(card) {
  return {
    stateDir: stateDirOf(card),
    intent: card.intent,
    managedWorktree: true,
    knobs: { quality: "production", explorationCount: 3, explorationHybrid: true },
    reviewGates: "[spec, interface, tech]",
    reviewRung: "Product Spec + Interface + Tech Review",
    instructions: "Preset instructions:\nstay narrow\n",
    prompt: card.prompt,
  };
}

/** The reseed builder's input, unwrapped from the shared card. */
function reseedInput(card) {
  return {
    card,
    rootPath: "/repo",
    intent: card.intent,
    seed: { stateDir: stateDirOf(card) },
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
function trackShared(card) {
  return {
    displayName: card.display_name,
    prompt: card.prompt,
    stateDirText: stateDirOf(card),
    workspaceRoot: "/repo",
    instructions: "stay narrow",
    flavor: "initial",
    previousThreadId: card.worker_thread_id,
  };
}

/**
 * All five spawn paths for one card, keyed by the name a failure should use.
 *
 * The three build paths carry the full protocol set; the two track prompts carry
 * the narrower set their workers can act on. Every path renders the same card
 * and the same instructions.
 */
export function renderSpawnPathsFor(card, { strategy = STRATEGY, stage = STAGE } = {}) {
  return {
    spawn: buildBuildPrompt(buildContext(card), RULES),
    restart: buildWorkerRestartPrompt({
      card,
      instructions: "stay narrow",
      stateHint: stateDirOf(card),
      stateDir: stateDirOf(card),
      protocols: RESTART_PROTOCOLS,
    }),
    reseed: buildReseedPrompt(reseedInput(card)),
    research: trackPrompts.researchWorkerPrompt({
      ...trackShared(card),
      ...strategy,
      roundNo: 1,
      roundStamp: "2026-10-05",
      roundFile: `${strategy.strategyId}-2026-10-05-r1.md`,
    }),
    explore: trackPrompts.exploreWorkerPrompt({
      ...trackShared(card),
      stage,
    }),
  };
}

/** The canonical card's five paths, which is what most tests assert on. */
export function renderSpawnPaths() {
  return renderSpawnPathsFor(CARD);
}

/**
 * Each path rendered for TWO different cards: `[card, otherCard]`.
 *
 * This is the pair a provider cache is measured against, because a provider
 * reuses the longest common prefix and two spawns for the same card are the
 * easy case. The tracks render a different strategy and a different stage
 * besides, so the measurement is not flattered by a pair that only differs in
 * a path segment.
 */
export function renderSpawnPairs() {
  const first = renderSpawnPathsFor(CARD, { strategy: STRATEGY, stage: STAGE });
  const second = renderSpawnPathsFor(OTHER_CARD, { strategy: OTHER_STRATEGY, stage: OTHER_STAGE });
  return Object.fromEntries(
    Object.keys(first).map((path) => [path, [first[path], second[path]]]),
  );
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

/** The clause texts, keyed as the BUILD bag names them, for presence checks that
 * look at prose rather than at a token. */
export function clauseTexts() {
  return { ...WORKER_PROTOCOL_CLAUSES };
}

/** The track bag's texts. Separate from `clauseTexts()` because the bags differ
 * where it matters (`doneProtocol` vs `doneProtocolTrack`), and a merged map
 * would let a budget entry for one resolve against the other. */
export function trackClauseTexts() {
  return { ...TRACK_PROTOCOL_CLAUSES };
}

/** Both bags, for a check that spans every path. The BUILD bag wins on a shared
 * key on purpose: the two bags reuse most keys for the same const, and the one
 * key they do not share (`doneProtocolTrack`) is a different clause rather than
 * a second name for the build one. */
export function allClauseTexts() {
  return { ...TRACK_PROTOCOL_CLAUSES, ...WORKER_PROTOCOL_CLAUSES };
}
