import assert from "node:assert/strict";
import { tasksToScoreQuestions, resolveTaskVerdicts, TASK_EVIDENCE_DIFF_CHARS } from "../lib/task-evidence.mjs";

// Task evidence turns a completed status (a worker assertion) into a
// checkable question: given the diff, does each completed task show
// evidence? One atomic Score per task, resolved against the point floor.
// Every non-verdict degrades to unverifiable — the caller reports, never
// blocks.
const tasks = [
  { id: "t1", name: "Add validation", scope: "Checkout" },
  { id: "t2", name: "Write tests", scope: "Checkout" },
];
const questions = tasksToScoreQuestions(tasks);
assert.deepEqual(Object.keys(questions), ["task:t1", "task:t2"], "one atomic question per task, keyed for lookup");
assert.equal(questions["task:t1"].type, "score", "tasks judge on the Score shape like criteria");
assert.ok(questions["task:t1"].instructions.includes("Add validation"), "the task reaches the judge");
assert.ok(questions["task:t1"].instructions.includes("Checkout"), "the parent scope disambiguates");
assert.deepEqual(tasksToScoreQuestions(null), {}, "junk builds no questions");
assert.deepEqual(tasksToScoreQuestions([{ name: "No id" }]), {}, "id-less tasks ask nothing");

const met = resolveTaskVerdicts({
  tasks,
  answers: { "task:t1": { type: "score", score: 2, confidence: 0.9 }, "task:t2": { type: "score", score: 0, confidence: 0.8 } },
  routeAt: 0.6,
});
assert.deepEqual(met.map((finding) => finding.verdict), ["met", "unmet"], "scores resolve through the shared anchors");
assert.deepEqual(
  resolveTaskVerdicts({ tasks, answers: { "task:t1": { type: "score", score: 2, confidence: 0.2 } }, routeAt: 0.6 }).map((finding) => finding.verdict),
  ["unverifiable", "unverifiable"],
  "below-floor confidence and missing answers degrade, never guess",
);
assert.deepEqual(
  resolveTaskVerdicts({ tasks, verdicts: { t1: { status: "met", confidence: 0.9 }, t2: { status: "maybe", confidence: 0.9 } }, routeAt: 0.6 }).map((finding) => finding.verdict),
  ["met", "unverifiable"],
  "preset verdicts map onto the same shape; unknown statuses degrade",
);
assert.equal(TASK_EVIDENCE_DIFF_CHARS, 6000, "diff budget is a named constant, not inline magic");

console.log("task evidence test ok: atomic questions, floored verdicts, shared anchors");
