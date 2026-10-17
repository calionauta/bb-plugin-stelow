import assert from "node:assert/strict";
import {
  parseRoundPath,
  unregisteredSubstepPaths,
} from "../lib/research-rounds.mjs";
import { createResearchArtifactRuntime } from "../server/runtime/research-artifacts.ts";
import { listNestedFiles } from "../server/runtime/board-read.ts";

/**
 * Registration is not a licence.
 *
 * The depth gate used to be driven entirely by the worker's own manifest, so
 * writing every declared substep as a stub and registering only the umbrella
 * round file made a round read as ready. A real card's index states it in the
 * present tense: the per-step files are "deliberately NOT registered in
 * `state.md`, so they do not gate `verify`/`done`".
 *
 * That was accurate about the code and wrong about the method. The skill defines
 * a simulated hypothesis as a first-class output — "a plausible invented example
 * used to make a candidate concrete" — so the fix is richer labelled content,
 * not ten thin files. A gate the writer can switch off cannot tell those apart.
 *
 * The real filenames and paths, from the card that produced it.
 */

const ROUND = ".stelow/2026-09-24/sw-card_ncf0glu8";
const PRIMARY = `${ROUND}/rounds/job-to-be-done-r1-20260924-1205.md`;
const STAMP = "20260924-1205";
const STRATEGY = "job-to-be-done";

// Every declared substep the strategy names, and the files the worker wrote.
const DECLARED = [
  "contextual-segmentation", "thinking-styles", "jtbd-discovery", "competitors",
  "job-actors", "situational-variables", "functional-needs", "financial-needs",
  "emotional-social-jobs", "job-map-steps",
];
const step = (subskill) => `${ROUND}/rounds/job-to-be-done-${subskill}-r1-${STAMP}.md`;

const PRESENT = [
  PRIMARY,
  step("competitor-discovery"),
  step("contextual-segmentation"),
  step("demonstration"),
  step("emotional-social-jobs"),
  step("financial-needs"),
  step("functional-needs"),
  step("job-actors"),
  step("job-map-steps"),
  step("jtbd-discovery"),
  step("situational-variables"),
  step("thinking-styles"),
];
// The worker registered the umbrella and one demo file. Nothing else.
const REGISTERED = [PRIMARY, step("demonstration")];

const gated = unregisteredSubstepPaths(DECLARED, REGISTERED, PRESENT, STRATEGY, PRIMARY);

assert.deepEqual(
  gated.map((path) => parseRoundPath(path, STRATEGY).subskill).sort(),
  [
    "contextual-segmentation", "emotional-social-jobs", "financial-needs",
    "functional-needs", "job-actors", "job-map-steps", "jtbd-discovery",
    "situational-variables", "thinking-styles",
  ],
  "every declared substep the worker wrote is gated, even unregistered — the nine stubs on that card are exactly this list",
);

// `demonstration` is present and unregistered but is NOT a declared substep, so
// it stays ungated: the gate covers the method's steps, not every file.
assert.ok(
  !gated.includes(step("demonstration")),
  "a file that is not a declared substep is not gated by this rule",
);
// The umbrella is the round itself, never its own substep.
assert.ok(!gated.includes(PRIMARY), "the round's own file is never treated as a substep");

// A registered substep is not double-counted: the manifest path already gates it.
assert.ok(
  !unregisteredSubstepPaths(DECLARED, [...REGISTERED, step("job-actors")], PRESENT, STRATEGY, PRIMARY).includes(step("job-actors")),
  "a substep that IS registered is not returned twice",
);

// A legitimately partial run still finishes. A declared substep that was never
// written has nothing to gate, and this rule must not invent a failure for it.
assert.deepEqual(
  unregisteredSubstepPaths(DECLARED, REGISTERED, [PRIMARY], STRATEGY, PRIMARY),
  [],
  "a run that wrote only the round file is untouched — nothing exists to gate",
);

// Another round's stamp is a different round, not a late substep of this one.
const otherRound = `${ROUND}/rounds/job-to-be-done-job-actors-r1-20260924-9999.md`;
assert.deepEqual(
  unregisteredSubstepPaths(DECLARED, REGISTERED, [PRIMARY, otherRound], STRATEGY, PRIMARY),
  [],
  "a substep from a different round stamp is not attributed to this round",
);

// Nothing declared, nothing gated — an unmigrated strategy is left alone rather
// than failed for substeps nobody declared.
assert.deepEqual(
  unregisteredSubstepPaths([], REGISTERED, PRESENT, STRATEGY, PRIMARY),
  [],
  "a strategy that declares no substeps gates nothing",
);

// Null inputs never throw, and the two that mean "nothing to compare" gate
// nothing. A null REGISTERED is the opposite case and the strongest one: with
// no manifest at all, every declared substep on disk is gated.
assert.deepEqual(unregisteredSubstepPaths(null, REGISTERED, PRESENT, STRATEGY, PRIMARY), [], "a null declared list gates nothing rather than throwing");
assert.deepEqual(unregisteredSubstepPaths(DECLARED, REGISTERED, null, STRATEGY, PRIMARY), [], "a null listing gates nothing rather than throwing");
assert.equal(
  unregisteredSubstepPaths(DECLARED, null, PRESENT, STRATEGY, PRIMARY).length,
  9,
  "with no manifest at all, every declared substep on disk is gated — the loophole does not open when state.md is simply absent",
);
assert.deepEqual(unregisteredSubstepPaths(DECLARED, REGISTERED, PRESENT, "not-a-strategy", PRIMARY), [], "an unknown strategy gates nothing");

// The pure function above cannot reach the two hops that make the gate run at
// all, and without them the loophole is open exactly as before. Driven through
// the runtime that owns the projection: the strategy's declared substeps and
// the round directory listing both reach the gate, so an unregistered substep
// the worker wrote is reported invalid and blocks the round.
const STATE_DIR = "/repo/.stelow/2026-09-24/hash-1";
const manifest = [
  "---",
  "workflow_id: card_ncf0glu8",
  "current_stage: research",
  "---",
  "",
  "artifacts:",
  "  - stage: research",
  "    kind: document",
  `    path: ${step("demonstration")}`,
  "",
].join("\n");
const FILES = {
  [`${STATE_DIR}/state.md`]: manifest,
  ...Object.fromEntries(PRESENT.map((path) => [`/repo/${path}`, "x"])),
};

const runtime = createResearchArtifactRuntime({
  bb: {
    sdk: {
      files: {
        read: async ({ path }) => {
          if (!(path in FILES)) throw new Error(`missing ${path}`);
          return { content: FILES[path] };
        },
      },
    },
  },
  cardWorkspace: async () => ({ path: "/repo", hostId: "host-1" }),
  workflowStateDir: async () => STATE_DIR,
  strategyRounds: () => [{ id: STRATEGY, at: "2026-09-24T12:05:00.000Z", file: PRIMARY }],
  joinPath: (root, relative) => `${root}/${relative}`,
  roundFiles: async () => PRESENT,
  workspaceRelative: (root, path) => path.replace(`${root}/`, ""),
  errors: { workspaceUnavailable: "Workspace is unavailable." },
});

const invalid = await runtime.researchRoundIntegrity({
  id: "card_ncf0glu8",
  kind: "research",
  dir_hash: "hash-1",
});
const invalidSlugs = new Set(invalid.map((entry) => entry.slug).filter(Boolean));
for (const path of gated) {
  const slug = parseRoundPath(path, STRATEGY).subskill;
  assert.ok(
    invalidSlugs.has(slug),
    `${slug}: the gate passes the STRATEGY's declared substeps and the round listing, so a substep present on disk is invalid whether or not it was registered`,
  );
}
assert.ok(!invalidSlugs.has("competitors"), "a declared substep the worker never wrote is not gated — nothing exists to check");

// The listing the gate compares against is the ONE nested walk the board also
// uses (`listNestedFiles`): a substep one level down is found, so the gate and
// the board agree about what the round directory contains.
const directories = {
  "/repo/rounds": [
    { path: "job-to-be-done-r1-20260924-1205.md", kind: "file" },
    { path: "job-to-be-done-demonstration-r1-20260924-1205.md", kind: "file" },
    { path: "nested", kind: "directory" },
  ],
  "/repo/rounds/nested": [
    { path: "job-to-be-done-job-actors-r1-20260924-1205.md", kind: "file" },
  ],
};
const listed = await listNestedFiles({
  listPaths: async ({ path }) => ({ paths: directories[path] ?? [] }),
}, "/repo/rounds");
assert.ok(
  listed.includes("/repo/rounds/nested/job-to-be-done-job-actors-r1-20260924-1205.md"),
  "the round listing descends one level, so a nested substep is found here as it is on the board",
);

console.log("research substep gate test ok: a declared substep is gated whether or not the worker registered it");
