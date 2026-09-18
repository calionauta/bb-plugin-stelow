import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROUNDS_DIR, slugify, roundTimestamp, roundFileName, parseRoundPath, substepPathsForRound, normalizeHistory } from "../lib/research-rounds.mjs";

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
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.ts"), "utf8");
assert.match(serverSource, /if \(!artifact \|\| !isPublishableArtifactContent\(artifact\.content\)\) continue;/, "empty sub-step artifacts are skipped");
assert.match(serverSource, /round\.status === "pending" && isPublishableArtifactContent\(content\) && !researchRoundMirrorsIndex/, "empty pending primary artifacts are skipped");
assert.match(serverSource, /async function ensureArtifactParent/, "round directories are created without reserving empty files");
assert.doesNotMatch(serverSource, /ensureRoundFile/, "the old empty-file helper is gone");

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

console.log("research rounds test ok: paths, strict history, round path parsing");
