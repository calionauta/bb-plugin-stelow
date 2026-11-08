import assert from "node:assert/strict";
import { ROUNDS_DIR, slugify, roundTimestamp, roundFileName, parseRoundPath, substepPathsForRound, normalizeHistory } from "../lib/research-rounds.mjs";
import { createResearchArtifactRuntime } from "../server/runtime/research-artifacts.ts";
import { createCardSeams } from "../server/runtime/card-seams.ts";

// Naming: <strategy>[-<subskill>]-r<n>-<stamp>.md basenames (the server
// nests them under the state dir's rounds/); slugs stay filesystem-safe.
assert.equal(roundFileName("pricing", 2, "20260905-1830"), "pricing-r2-20260905-1830.md", "round file name");
assert.equal(
  roundFileName("job-to-be-done", 1, "20260905-1835", "Job Map Steps"),
  "job-to-be-done-job-map-steps-r1-20260905-1835.md",
  "subskill file name",
);
assert.equal(slugify("Job Map Steps!!"), "job-map-steps", "slugify");
assert.match(roundTimestamp(new Date("2026-09-05T18:35:00Z")), /^\d{8}-\d{4}$/, "stamp shape");

// History is strict [{id, at, file}]: file defaults to "" (missing, never
// vanished); an unrecognized shape degrades to [].
assert.deepEqual(normalizeHistory('[{"id":"a","at":"t","file":"f"}]'), [{ id: "a", at: "t", file: "f" }], "round entry");
assert.deepEqual(normalizeHistory('[{"id":"a","at":"t"}]'), [{ id: "a", at: "t", file: "" }], "missing file defaults empty");
assert.deepEqual(normalizeHistory('["a","b"]'), [], "an id array is not a history either");
assert.deepEqual(normalizeHistory('[{"id":"a"}]'), [], "entries missing id/at are dropped");
assert.deepEqual(normalizeHistory(null), [], "nothing yields no history");
assert.deepEqual(normalizeHistory("not-json"), [], "corrupt JSON yields no history");

// Round paths parse back for a known strategy id (nesting irrelevant).
assert.deepEqual(
  parseRoundPath(".stelow/2026-09-05/abc123/rounds/pricing-r2-20260905-1830.md", "pricing"),
  { subskill: null, roundNo: 2, stamp: "20260905-1830" },
  "primary file parses",
);
assert.deepEqual(
  parseRoundPath(".stelow/2026-09-05/abc123/rounds/job-to-be-done-job-map-steps-r1-20260905-1835.md", "job-to-be-done"),
  { subskill: "job-map-steps", roundNo: 1, stamp: "20260905-1835" },
  "subskill file parses",
);
assert.equal(parseRoundPath("rounds/pricing-r2-20260905-1830.md", "paywall"), null, "wrong strategy");
assert.equal(parseRoundPath("plans/spec-product_v1.md", "pricing"), null, "non-round file");

// All user-facing round files, including pending primaries and optional
// sub-steps, share the publishability guard. A reserved path may be missing;
// neither an empty placeholder nor whitespace may render as an artifact.
// Driven through the runtime that lists them: the guard is an outcome (which
// files a round exposes) rather than a line of source.
const STATE_DIR = "/repo/.stelow/2026-09-24/hash-1";
const PRIMARY = `${ROUNDS_DIR}/pricing-r1-20260924-0000.md`;
const INDEX_BLOB = "# Research index\n\n## Opportunities\n";
const REAL_ROUND = `# Pricing analysis\n\n${"A concrete pricing finding with evidence. ".repeat(12)}`;

function roundRuntime(files) {
  return createResearchArtifactRuntime({
    bb: {
      sdk: {
        files: {
          read: async ({ path }) => {
            if (!(path in files)) throw new Error(`unexpected read: ${path}`);
            return { content: files[path] };
          },
        },
      },
    },
    cardWorkspace: async () => ({ path: "/repo", hostId: "host-1" }),
    workflowStateDir: async () => STATE_DIR,
    strategyRounds: () => [{ id: "pricing", at: "2026-09-24T00:00:00Z", file: PRIMARY }],
    joinPath: (root, relative) => `${root}/${relative}`,
    roundFiles: async () => [],
    workspaceRelative: (root, path) => path.replace(`${root}/`, ""),
    errors: { workspaceUnavailable: "Workspace is unavailable." },
  });
}

async function projectedRound(files, live = false) {
  const { rounds } = await roundRuntime(files).researchRoundFiles(
    "/repo",
    "host-1",
    STATE_DIR,
    [{ id: "pricing", at: "2026-09-24T00:00:00Z", file: PRIMARY }],
    live,
  );
  return rounds[0];
}

// A fan-out sub-step the manifest declared but left blank is not listed; its
// sibling with real playbook output is.
const SUBSTEP_BLANK = `${ROUNDS_DIR}/pricing-job-map-steps-r1-20260924-0000.md`;
const SUBSTEP_REAL = `${ROUNDS_DIR}/pricing-functional-needs-r1-20260924-0000.md`;
const withSubsteps = await projectedRound({
  [`${STATE_DIR}/state.md`]: `artifacts:
  - stage: research
    path: ${SUBSTEP_BLANK}
    label: Job map steps
  - stage: research
    path: ${SUBSTEP_REAL}
    label: Functional needs
`,
  [`/repo/${SUBSTEP_BLANK}`]: "   \n\n",
  [`/repo/${SUBSTEP_REAL}`]: REAL_ROUND,
  [`/repo/${PRIMARY}`]: REAL_ROUND,
  [`${STATE_DIR}/research-index.md`]: INDEX_BLOB,
});
assert.deepEqual(
  withSubsteps.files.map((file) => file.path),
  [PRIMARY, SUBSTEP_REAL],
  "a blank sub-step artifact is not listed; a real one is",
);

// A pending primary (the last round, still live) is listed only when it holds
// publishable content — a placeholder path never renders as a document.
const pendingFiles = { [`${STATE_DIR}/state.md`]: "artifacts:\n", [`${STATE_DIR}/research-index.md`]: INDEX_BLOB };
const blankPending = await projectedRound({ ...pendingFiles, [`/repo/${PRIMARY}`]: "   \n\n" }, true);
assert.equal(blankPending.status, "pending", "a blank last round is still pending, not missing");
assert.deepEqual(blankPending.files, [], "a blank pending primary is not listed as an artifact");
const thinPending = await projectedRound({ ...pendingFiles, [`/repo/${PRIMARY}`]: "x".repeat(30) }, true);
assert.equal(thinPending.status, "pending", "a thin last round stays pending");
assert.deepEqual(thinPending.files.map((file) => file.path), [PRIMARY], "a publishable pending primary is listed");
const mirroredPending = await projectedRound({ ...pendingFiles, [`/repo/${PRIMARY}`]: INDEX_BLOB }, true);
assert.deepEqual(mirroredPending.files, [], "a pending primary that only mirrors the index is not listed");

// Round directories are ensured without reserving an empty file. Every
// sdk.files call the seam makes is recorded, so the claim is about the one
// effect it has — the parent directory — rather than about the name of a
// helper: a reservation that also wrote the round path fails here, and an
// unused helper fails lint instead.
const fileEffects = [];
const seams = createCardSeams({
  bb: {
    sdk: {
      files: new Proxy({}, {
        get: (_target, method) => async (...args) => {
          fileEffects.push({ method, args });
        },
      }),
    },
  },
  db: {},
  getCard: () => undefined,
  cardWorkspace: async () => null,
  workerEnvironmentOf: async () => null,
});
await seams.ensureArtifactParent("/repo", PRIMARY);
assert.deepEqual(
  fileEffects,
  [{ method: "mkdir", args: [{ path: `/repo/${ROUNDS_DIR}`, rootPath: "/repo", recursive: true }] }],
  "a round path creates its parent directory and reserves no file",
);
assert.deepEqual(
  Object.keys(seams).filter((name) => /roundFile/i.test(name)),
  [],
  "the round seams offer no file-reservation entry point any more",
);

// Substep join: manifest paths attach to the primary sharing strategy +
// round + stamp; primaries, other rounds/stamps/strategies never join.
const primary = ".stelow/s1/rounds/job-to-be-done-r1-20260905-1835.md";
const manifest = [
  primary,
  ".stelow/s1/rounds/job-to-be-done-job-map-steps-r1-20260905-1835.md",
  ".stelow/s1/rounds/job-to-be-done-functional-needs-r1-20260905-1835.md",
  ".stelow/s1/rounds/job-to-be-done-job-map-steps-r1-20260905-1835.md",
  ".stelow/s1/rounds/job-to-be-done-job-map-steps-r2-20260905-1835.md",
  ".stelow/s1/rounds/job-to-be-done-job-map-steps-r1-20260906-0900.md",
  ".stelow/s1/rounds/pricing-job-map-steps-r1-20260905-1835.md",
  "plans/spec-product_v1.md",
];
assert.deepEqual(substepPathsForRound(manifest, "job-to-be-done", primary), [
  ".stelow/s1/rounds/job-to-be-done-job-map-steps-r1-20260905-1835.md",
  ".stelow/s1/rounds/job-to-be-done-functional-needs-r1-20260905-1835.md",
], "substeps join on strategy+round+stamp, deduplicated");
assert.deepEqual(substepPathsForRound([], "job-to-be-done", primary), [], "no manifest means no substeps");
assert.deepEqual(substepPathsForRound(manifest, "job-to-be-done", "plans/spec.md"), [], "unparseable primary joins nothing");

console.log("research rounds test ok: paths, strict history, round path parsing, publishability guard, and directory seams");
