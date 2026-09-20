import assert from "node:assert/strict";
import { buildPresetJudgePrompt, parsePresetJudgeOutput } from "../lib/preset-judge.mjs";
import { TRIAGE_INTENT_CRITERIA, triageIntentQuestions } from "../lib/decision-points.mjs";

// The preset judge answers inside one fenced JSON block after free reasoning.
// The prompt must carry the state, the question, and the closed option set —
// a judge that can invent options is a router that cannot route.
const prompt = buildPresetJudgePrompt({ kind: "choice", state: "The login button does nothing.", questions: triageIntentQuestions() });
assert.ok(prompt.includes("The login button does nothing."), "the state reaches the judge");
assert.ok(prompt.includes("Which workflow intent"), "the question reaches the judge");
for (const id of Object.keys(TRIAGE_INTENT_CRITERIA)) {
  assert.ok(prompt.includes(id), `the closed option set names ${id}`);
}
assert.ok(prompt.includes("```json"), "the verdict contract is a fenced block");

// A valid fenced verdict normalizes to choice + confidence.
const good = parsePresetJudgeOutput({
  kind: "choice",
  text: `Some reasoning about the crash.\n\`\`\`json\n{"choice": "bugfix", "confidence": 0.85}\n\`\`\``,
  validChoices: Object.keys(TRIAGE_INTENT_CRITERIA),
});
assert.deepEqual(good, { ok: true, choice: "bugfix", confidence: 0.85 });

// The LAST block wins, so trailing chatter after the verdict cannot spoof it
// and a corrected verdict supersedes an earlier one.
const last = parsePresetJudgeOutput({
  kind: "choice",
  text: '```json\n{"choice": "feature", "confidence": 0.4}\n```\nOn reflection:\n```json\n{"choice": "bugfix", "confidence": 0.9}\n```',
  validChoices: Object.keys(TRIAGE_INTENT_CRITERIA),
});
assert.deepEqual(last, { ok: true, choice: "bugfix", confidence: 0.9 });

// Every failure mode fails closed with a named error — the call site falls
// back to built-in rules, never to a guessed intent.
for (const [label, text] of [
  ["no fence", "just prose, no block"],
  ["bad json", "```json\n{choice: bugfix}\n```"],
  ["wrong shape", '```json\n{"answer": "bugfix"}\n```'],
  ["invented choice", '```json\n{"choice": "teleport", "confidence": 1}\n```'],
]) {
  const parsed = parsePresetJudgeOutput({ kind: "choice", text, validChoices: Object.keys(TRIAGE_INTENT_CRITERIA) });
  assert.equal(parsed.ok, false, `${label} fails closed`);
  assert.equal(typeof parsed.error, "string", `${label} names its failure`);
}

// Confidence is optional and clamped: a missing or wild value degrades to
// null instead of poisoning the threshold comparison.
assert.deepEqual(
  parsePresetJudgeOutput({ kind: "choice", text: '```{"choice": "bugfix"}```', validChoices: ["bugfix"] }),
  { ok: true, choice: "bugfix", confidence: null },
);
assert.deepEqual(
  parsePresetJudgeOutput({ kind: "choice", text: '```{"choice": "bugfix", "confidence": 9}\n```', validChoices: ["bugfix"] }),
  { ok: true, choice: "bugfix", confidence: 1 },
);

// Criteria mode: per-criterion verdicts validate enums, coerce bad statuses
// to unverifiable, and drop entries without an id — never throw.
const criteria = parsePresetJudgeOutput({
  kind: "criteria",
  text: '```json\n{"verdicts": [{"id": "c1", "status": "met", "confidence": 0.8}, {"id": "c2", "status": "maybe", "confidence": "high"}, {"noid": true}]}\n```',
});
assert.deepEqual(criteria, {
  ok: true,
  verdicts: [
    { id: "c1", status: "met", confidence: 0.8 },
    { id: "c2", status: "unverifiable", confidence: null },
  ],
});
const criteriaPrompt = buildPresetJudgePrompt({ kind: "criteria", state: "artifact text", questions: [{ id: "c1", text: "Has a title" }] });
assert.ok(criteriaPrompt.includes("[c1] Has a title"), "criteria reach the judge by id");
assert.ok(criteriaPrompt.includes("```json"), "criteria verdicts use the same fenced contract");

console.log("preset judge test ok: prompt contract, last-block-wins, fail-closed parsing");
