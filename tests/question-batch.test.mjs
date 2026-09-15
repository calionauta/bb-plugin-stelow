import assert from "node:assert/strict";
import {
  parseAskGroups,
  normalizeAskArtifactPath,
  inheritAskArtifact,
  isBatchPayload,
  expandInteractionQuestions,
  splitQuestionId,
  groupBatchAnswers,
  formatBatchContinuation,
} from "../lib/question-batch.mjs";

// CLI group parsing: repeated --question blocks, options attach to current.
{
  const single = parseAskGroups(["--thread", "t", "--question", "Q?", "--option", "A", "--option", "B"]);
  assert.equal(single.error, undefined);
  assert.equal(single.groups.length, 1);
  assert.deepEqual(single.groups[0], { question: "Q?", multiple: false, options: [{ label: "A", description: "", preview: null, artifact: null }, { label: "B", description: "", preview: null, artifact: null }] });
}
{
  const multi = parseAskGroups(["--question", "Q1?", "--option", "A", "--option", "B", "--question", "Q2?", "--multiple", "--option", "C", "--option", "D"]);
  assert.equal(multi.error, undefined);
  assert.equal(multi.groups.length, 2);
  assert.equal(multi.groups[0].multiple, false);
  assert.equal(multi.groups[1].multiple, true);
  assert.deepEqual(multi.groups[1].options.map((o) => o.label), ["C", "D"]);
}
{
  // Accept the unambiguous mode-first form emitted after `--tag split`.
  const modeFirst = parseAskGroups(["--multiple", "--question", "Q?", "--option", "A", "--option", "B"]);
  assert.equal(modeFirst.error, undefined);
  assert.equal(modeFirst.groups[0].multiple, true);
}
{
  const short = parseAskGroups(["--question", "Q?", "--option", "Only"]);
  assert.match(short.error, /at least 2/);
}
{
  const empty = parseAskGroups(["--thread", "t"]);
  assert.match(empty.error, /Usage/);
}

// Payload shape detection + expansion.
assert.equal(isBatchPayload({ questions: [] }), true);
assert.equal(isBatchPayload({ question: "x", options: [] }), false);
{
  const single = expandInteractionQuestions({ id: "i1", title: "T", payload: { question: "Q?", multiple: false, options: [{ label: "A", description: "" }] } });
  assert.equal(single.length, 1);
  assert.equal(single[0].questionId, "i1", "a single question keeps the interaction id");
  assert.equal(single[0].index, 0);
  assert.equal(single[0].kind, "standard", "missing metadata safely defaults to a standard question");
}
{
  const batch = expandInteractionQuestions({
    id: "i9", title: "Batch", payload: { questions: [{ question: "Q1?", multiple: false, options: [{ label: "A", description: "" }] }, { question: "Q2?", multiple: true, options: [{ label: "B", description: "" }] }] },
  });
  assert.equal(batch.length, 2);
  assert.equal(batch[0].questionId, "i9#0");
  assert.equal(batch[1].questionId, "i9#1");
  assert.equal(batch[1].multiple, true);
}
{
  const typed = expandInteractionQuestions({ id: "i10", payload: { question: "Split?", multiple: true, kind: "split", options: [{ label: "A", description: "" }] } });
  assert.equal(typed[0].kind, "split", "semantic question kind survives host interaction expansion");
}
{
  // Malformed sub-questions drop out; one bad apple never kills the batch.
  const partial = expandInteractionQuestions({ id: "i9", payload: { questions: [{ question: "bad", options: [] }, "junk", { question: "Q?", options: [{ label: "A", description: "" }] }] } });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].questionId, "i9#2");
}

// Id splitting round-trips the expansion scheme.
assert.deepEqual(splitQuestionId("i1"), { interactionId: "i1", index: 0 });
assert.deepEqual(splitQuestionId("i9#2"), { interactionId: "i9", index: 2 });

// Answer grouping: one response per interaction, dense batch arrays.
{
  const grouped = groupBatchAnswers([
    { questionId: "i1", answers: ["A"] },
    { questionId: "i9#0", answers: ["X"] },
    { questionId: "i9#1", answers: ["Y", "Z"] },
  ]);
  assert.equal(grouped.size, 2);
  assert.deepEqual(grouped.get("i1"), { kind: "single", answers: ["A"] });
  assert.deepEqual(grouped.get("i9"), { kind: "batch", answers: [["X"], ["Y", "Z"]] });
}
{
  // Gaps densify to [] (skipped slot) and duplicates keep first write.
  const grouped = groupBatchAnswers([
    { questionId: "i9#1", answers: ["Y"] },
    { questionId: "i9#1", answers: ["OTHER"] },
  ]);
  assert.deepEqual(grouped.get("i9"), { kind: "batch", answers: [[], ["Y"]] });
}
{
  // Non-string answers are stripped, never crash the worker message.
  const grouped = groupBatchAnswers([{ questionId: "i1", answers: ["A", 42, null] }]);
  assert.deepEqual(grouped.get("i1"), { kind: "single", answers: ["A"] });
}

// Continuation text: atomic submit => one resume message.
{
  const text = formatBatchContinuation([{ question: "Q1?", answers: ["A"] }]);
  assert.match(text, /the pending question/);
  assert.match(text, /Q: Q1\?\nA: A/);
  const multi = formatBatchContinuation([{ question: "Q1?", answers: [] }, { question: "Q2?", answers: ["B", "C"] }]);
  assert.match(multi, /all 2 pending questions at once/);
  assert.match(multi, /skipped — use your recommendation/);
  assert.match(multi, /B, C/);
}

// Option detail flags attach to the most recent --option; caps bound payloads.
{
  const rich = parseAskGroups(["--question", "Q?", "--option", "A", "--desc", "Why A", "--preview", "```\nwire\n```", "--artifact", "rounds/a-r1.md", "--option", "B"]);
  assert.equal(rich.error, undefined);
  assert.deepEqual(rich.groups[0].options[0], { label: "A", description: "Why A", preview: "```\nwire\n```", artifact: { path: "rounds/a-r1.md" } });
  assert.deepEqual(rich.groups[0].options[1], { label: "B", description: "", preview: null, artifact: null });
}
{
  const stray = parseAskGroups(["--question", "Q?", "--desc", "orphan", "--option", "A", "--option", "B"]);
  assert.match(stray.error, /must follow a --option/);
}
{
  const long = parseAskGroups(["--question", "Q?", "--option", "A", "--preview", "x".repeat(5000), "--option", "B"]);
  assert.equal(long.error, undefined);
  assert.equal(long.groups[0].options[0].preview.length, 4000);
}
{
  const badPath = parseAskGroups(["--question", "Q?", "--option", "A", "--artifact", "x".repeat(600), "--option", "B"]);
  assert.match(badPath.error, /workspace-relative path/);
}

// Expansion keeps label-only options and normalizes rich ones.
{
  const mixed = expandInteractionQuestions({ id: "i2", title: "T", payload: { question: "Q?", multiple: false, options: ["A", { label: "B", description: "d", preview: "p", artifact: { path: "f.md" } }, { label: "" }] } });
  assert.equal(mixed.length, 1);
  assert.deepEqual(mixed[0].options, [
    { label: "A", description: "", preview: null, artifact: null },
    { label: "B", description: "d", preview: "p", artifact: { path: "f.md", display: "f.md" } },
  ]);
}

// Artifact path normalization: one shared verdict on validity.
{
  assert.deepEqual(normalizeAskArtifactPath("rounds/a-r1.md"), { path: "rounds/a-r1.md", display: "a-r1.md" }, "basename display");
  assert.deepEqual(normalizeAskArtifactPath("./x.md"), { path: "x.md", display: "x.md" }, "leading ./ stripped");
  assert.equal(normalizeAskArtifactPath(""), null, "empty has no affordance");
  assert.equal(normalizeAskArtifactPath(null), null, "null has no affordance");
  assert.equal(normalizeAskArtifactPath(42), null, "non-string has no affordance");
  assert.equal(normalizeAskArtifactPath("x".repeat(501)), null, "over-cap has no affordance");
}

// Per-option evidence inheritance: the approval option must be readable too.
// The real 2026-09-15 plan gate attached --artifact to "Request changes"
// only, so "Approve plan" rendered with no Open document affordance at all.
{
  const realGateAsk = [
    { label: "Approve plan", description: "Proceed to execution.", preview: null, artifact: null },
    { label: "Request changes", description: "Returns to planning.", preview: null, artifact: { path: ".stelow/2026-09-15/sw-card_gcmixvq7/plans/spec-tech_v1.md" } },
  ];
  const plan = inheritAskArtifact(realGateAsk);
  assert.deepEqual(plan.map((artifact) => artifact && artifact.path), [
    ".stelow/2026-09-15/sw-card_gcmixvq7/plans/spec-tech_v1.md",
    ".stelow/2026-09-15/sw-card_gcmixvq7/plans/spec-tech_v1.md",
  ], "the approval inherits the document the ask attached to its siblings");
  assert.equal(plan[0].display, "spec-tech_v1.md", "the inherited artifact is normalized for the viewer");
}
{
  const competing = [
    { label: "Option A", artifact: { path: "rounds/a-r1.md" } },
    { label: "Option B", artifact: { path: "rounds/b-r1.md" } },
  ];
  assert.deepEqual(inheritAskArtifact(competing).map((artifact) => artifact && artifact.path), ["rounds/a-r1.md", "rounds/b-r1.md"], "competing proposals keep their own documents");
}
{
  assert.deepEqual(inheritAskArtifact([{ label: "A" }, { label: "B" }]), [null, null], "nothing attached yields no affordance, so manifest recovery still applies");
  assert.deepEqual(inheritAskArtifact([{ label: "A", artifact: { path: "" } }, { label: "B", artifact: { path: "./f.md" } }]).map((artifact) => artifact && artifact.path), ["f.md", "f.md"], "an unusable path is not evidence");
  assert.deepEqual(inheritAskArtifact([]), [], "no options, no artifacts");
  assert.deepEqual(inheritAskArtifact(undefined), [], "malformed input never throws");
  assert.deepEqual(inheritAskArtifact([{ label: "A", artifact: { path: "x".repeat(501) } }, { label: "B", artifact: null }]), [null, null], "over-cap paths are never inherited");
}

console.log("question batch test ok: cli groups, option details, expansion, atomic grouping, continuation, per-option evidence inheritance");
