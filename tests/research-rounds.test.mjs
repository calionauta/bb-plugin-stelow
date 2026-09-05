import assert from "node:assert/strict";
import { ROUNDS_DIR, slugify, roundTimestamp, roundFilePath, normalizeHistory, matchRoundFile, buildRoundsView } from "../lib/research-rounds.mjs";

// Naming: rounds/<strategy>[-<subskill>]-r<n>-<stamp>.md, slugs stay
// filesystem-safe and human-sortable.
assert.equal(roundFilePath("pricing", 2, "20260905-1830"), "rounds/pricing-r2-20260905-1830.md", "round file path");
assert.equal(
  roundFilePath("job-to-be-done", 1, "20260905-1835", "Job Map Steps"),
  "rounds/job-to-be-done-job-map-steps-r1-20260905-1835.md",
  "subskill file path",
);
assert.equal(slugify("Job Map Steps!!"), "job-map-steps", "slugify");
assert.match(roundTimestamp(new Date("2026-09-05T18:35:00Z")), /^\d{8}-\d{4}$/, "stamp shape");

// History: legacy id arrays degrade to at:null, new objects keep at,
// garbage degrades honestly.
assert.deepEqual(normalizeHistory('["a","b"]'), [{ id: "a", at: null }, { id: "b", at: null }], "legacy array");
assert.deepEqual(
  normalizeHistory('[{"id":"a","at":"2026-09-05T18:00:00Z"},{"id":"b"}]'),
  [{ id: "a", at: "2026-09-05T18:00:00Z" }, { id: "b", at: null }],
  "mixed array",
);
assert.deepEqual(normalizeHistory(null, "a"), [{ id: "a", at: null }], "legacy single id");
assert.deepEqual(normalizeHistory("not-json", "a"), [{ id: "a", at: null }], "corrupt JSON falls back");
assert.deepEqual(normalizeHistory("[1,2]", "a"), [{ id: "a", at: null }], "non-string entries fall back");
assert.deepEqual(normalizeHistory(null, null), [], "nothing yields no history");

// Round-file matching: strategy + 1-based round number, subskill tolerant.
assert.equal(matchRoundFile("rounds/pricing-r2-20260905-1830.md", "pricing", 2), true, "round file matches");
assert.equal(matchRoundFile("rounds/pricing-r2-20260905-1830.md", "pricing", 1), false, "wrong round number");
assert.equal(matchRoundFile("rounds/pricing-r2-20260905-1830.md", "paywall", 2), false, "wrong strategy");
assert.equal(
  matchRoundFile("rounds/job-to-be-done-job-map-steps-r1-20260905-1835.md", "job-to-be-done", 1),
  true,
  "subskill file matches its round",
);
assert.equal(matchRoundFile("plans/spec-product_v1.md", "pricing", 2), false, "outside rounds dir");
assert.equal(matchRoundFile("rounds/brief.md", "pricing", 2), false, "non-round file");

// Rounds view: history joined with manifest files, newest first,
// duplicates collapsed, honest pending/missing states.
const files = [
  { display: "Round 1 — Pricing", path: "rounds/pricing-r1-20260905-1800.md", absolutePath: "/w/rounds/pricing-r1-20260905-1800.md", hostId: "h", generatedAt: "2026-09-05T18:00:00Z" },
  { display: "Round 1 — Pricing", path: "rounds/pricing-r1-20260905-1800.md", absolutePath: "/w/rounds/pricing-r1-20260905-1800.md", hostId: "h", generatedAt: "2026-09-05T18:00:00Z" },
  { display: "Round 2 — JTBD (job map)", path: "rounds/job-to-be-done-job-map-steps-r2-20260905-1830.md", absolutePath: "/w/rounds/job-to-be-done-job-map-steps-r2-20260905-1830.md", hostId: "h", generatedAt: "" },
  { display: "Research brief", path: "brief.md", absolutePath: "/w/brief.md", hostId: "h", generatedAt: "" },
];
const history = [{ id: "pricing", at: "2026-09-05T18:00:00Z" }, { id: "job-to-be-done", at: null }];
const view = buildRoundsView(history, files, false);
assert.equal(view.length, 2, "two rounds");
assert.equal(view[0].n, 2, "newest first");
assert.equal(view[0].status, "ready", "round with files is ready");
assert.equal(view[0].files.length, 1, "subskill file joins its round");
assert.equal(view[0].files[0].generatedAt, "", "missing generatedAt stays empty (at is null)");
assert.equal(view[1].files.length, 1, "duplicate manifest entries collapse");
assert.deepEqual(
  buildRoundsView([{ id: "pricing", at: null }], [], true)[0].status,
  "pending",
  "latest live round without a file is pending",
);
assert.deepEqual(
  buildRoundsView([{ id: "pricing", at: null }], [], false)[0].status,
  "missing",
  "idle round without a file is missing",
);

console.log("research rounds test ok: paths, history normalization, round matching, rounds view");
