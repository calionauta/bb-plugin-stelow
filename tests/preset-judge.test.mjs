import assert from "node:assert/strict";
import { buildPresetJudgePrompt, parsePresetJudgeOutput } from "../lib/preset-judge.mjs";
import { TRIAGE_INTENT_CRITERIA, triageIntentQuestions } from "../lib/decision-points.mjs";

// The only shape the parser reads: one fenced JSON block, reasoning optional.
const fenced = (payload) => `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;

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

// Both refusals the mode checks can raise, named so a loosened check that
// stopped refusing is visible as a changed message, not a silent pass.
assert.equal(
  parsePresetJudgeOutput({ kind: "choice", text: fenced({ choice: "teleport" }), validChoices: ["bugfix"] }).error,
  "choice is missing or outside the allowed options",
);
assert.equal(
  parsePresetJudgeOutput({ kind: "criteria", text: fenced({ findings: [] }) }).error,
  "verdicts must be an array",
);

// Generated, not hand-picked: one payload per (key, value) pair plus the
// top-level shapes JSON can produce. The parser is total per mode, so every
// input either refuses or returns its mode's key — asserted for all of them,
// so a branch keyed on one of the seven keys below fails here. Its reach ends
// at those seven keys: a branch keyed on a field this list does not name is
// outside the sweep and would pass. That is why the sweep is a witness for the
// keys it enumerates, not the guarantee — the guarantee is the parser's own
// per-mode check, and it is the check a new branch must not skip.
const sweepKeys = ["choice", "verdicts", "verdict", "answer", "findings", "summary", "result"];
const sweepValues = ["bugfix", 7, null, [], [{ id: "c1" }], { c1: "met" }];
let swept = 0;
for (const kind of ["choice", "criteria"]) {
  for (const key of sweepKeys) {
    for (const value of sweepValues) {
      const parsed = parsePresetJudgeOutput({
        kind,
        text: fenced({ [key]: value }),
        validChoices: ["bugfix"],
      });
      assert.equal(typeof parsed.ok, "boolean", `${kind} ${key}: reports a verdict`);
      if (kind === "choice") {
        assert.ok(
          !parsed.ok || typeof parsed.choice === "string",
          `${kind} ${key}=${JSON.stringify(value)}: an accepted choice names its option`,
        );
      } else {
        assert.ok(
          !parsed.ok || Array.isArray(parsed.verdicts),
          `${kind} ${key}=${JSON.stringify(value)}: accepted criteria carry a verdicts array`,
        );
      }
      if (!parsed.ok) assert.equal(typeof parsed.error, "string", `${kind} ${key}: names its failure`);
      swept += 1;
    }
  }
  for (const value of [null, [], "bugfix", 7, true]) {
    const parsed = parsePresetJudgeOutput({ kind, text: fenced(value), validChoices: ["bugfix"] });
    assert.equal(typeof parsed.ok, "boolean", `${kind} top-level ${JSON.stringify(value)}: reports a verdict`);
    if (kind === "choice") {
      assert.ok(!parsed.ok || typeof parsed.choice === "string", `${kind} top-level: an accepted choice names its option`);
    } else {
      assert.ok(!parsed.ok || Array.isArray(parsed.verdicts), `${kind} top-level: accepted criteria carry a verdicts array`);
    }
    if (!parsed.ok) assert.equal(typeof parsed.error, "string", `${kind} top-level: names its failure`);
    swept += 1;
  }
}
// The sweep only proves something if it reaches both outcomes.
const outcomes = sweepKeys.flatMap((key) => sweepValues.map((value) =>
  parsePresetJudgeOutput({ kind: "criteria", text: fenced({ [key]: value }) }).ok));
assert.ok(outcomes.includes(true), "the criteria sweep covers an accepted verdict");
assert.ok(outcomes.includes(false), "the criteria sweep covers refusals");

console.log(`preset judge test ok: prompt contract, last-block-wins, fail-closed parsing, ${swept} shapes total`);
