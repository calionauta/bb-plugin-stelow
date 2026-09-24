import assert from "node:assert/strict";
import { selectBuildReviewArtifact } from "../lib/build-review-target.mjs";

const stageArtifact = { role: "deliverable", stage: "shape", path: "shape.md" };
const newerArtifact = { role: "deliverable", stage: "draft", path: "newer.md" };
const evidenceArtifact = { role: "evidence", stage: "shape", path: "receipt.json" };
const questionArtifact = { role: "deliverable", stage: "draft", path: "question.md" };
const expiredArtifact = { role: "deliverable", stage: "draft", path: "expired.md" };
const card = { stage: "gate" };

function detail(overrides = {}) {
  return {
    pendingQuestions: [],
    expiredQuestions: [],
    artifacts: [stageArtifact, newerArtifact],
    ...overrides,
  };
}

assert.equal(
  selectBuildReviewArtifact({ detail: detail(), card, heroKind: "working" }),
  null,
  "ordinary work never invents a review entry",
);
assert.equal(
  selectBuildReviewArtifact({
    detail: detail({ artifacts: [...detail().artifacts, evidenceArtifact] }),
    card,
    heroKind: "decision",
  }),
  stageArtifact,
  "a stage manifest artifact beats a newer deliverable and never selects evidence",
);
assert.equal(
  selectBuildReviewArtifact({
    detail: detail({
      pendingQuestions: [{ options: [{ artifact: questionArtifact }] }],
    }),
    card,
    heroKind: "decision",
  }),
  questionArtifact,
  "the document attached to the live question wins over the stage guess",
);
assert.equal(
  selectBuildReviewArtifact({
    detail: detail({
      pendingQuestions: [],
      expiredQuestions: [{ options: [{ artifact: expiredArtifact }] }],
    }),
    card,
    heroKind: "decision",
  }),
  expiredArtifact,
  "the document attached to an expired decision stays reviewable",
);
assert.equal(
  selectBuildReviewArtifact({
    detail: detail({
      artifacts: [evidenceArtifact, newerArtifact],
      pendingQuestions: [{ options: [{ artifact: questionArtifact }] }],
    }),
    card,
    heroKind: "working",
  }),
  questionArtifact,
  "a live question is eligible even while the stale hero is not a decision",
);
assert.equal(
  selectBuildReviewArtifact({
    detail: detail({ artifacts: [evidenceArtifact, newerArtifact] }),
    card: { stage: "unknown" },
    heroKind: "decision",
  }),
  newerArtifact,
  "the newest deliverable is only the final fallback",
);

console.log("build review target test ok: question evidence wins, manifest fallback excludes receipts");
