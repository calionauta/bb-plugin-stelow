import assert from "node:assert/strict";
import { advancedFrom, firstTurnTrailLine, firstTurnVerdict, skillReads } from "../lib/first-turn-contract.mjs";

/**
 * The first-turn contract, measured from what the worker actually did.
 *
 * A worker's first turn is the most expensive and least informed: it has just been
 * handed a 12,000-character prompt naming its stage, and the skill family it used to
 * be told to read is 17 skills whose entry documents total 215,756 bytes (~54k
 * tokens). Measured on this checkout, exactly one skill read happened across ten
 * workers, which is why this is a contract with a report rather than a blocking rule:
 * the cost is real and the observation is cheap, so the number should be visible on
 * the card instead of being argued about from memory.
 *
 * Enforcement is possible because the plugin can read the worker's events: a skill
 * load is a `toolCall` item whose arguments name a `SKILL.md`. This file pins that
 * reading, including the cases that must NOT count.
 */

const skillCall = (path, tool = "read") => ({
  data: { item: { type: "toolCall", tool, arguments: { path } } },
});
const advanceCall = () => ({
  data: { item: { type: "toolCall", tool: "bash", arguments: { command: "bb stelow advance execution" } } },
});
const otherCall = (path) => ({
  data: { item: { type: "toolCall", tool: "read", arguments: { path } } },
});
const reasoning = { data: { item: { type: "reasoning", content: "thinking" } } };

const SKILL_A = "/cache/skills/stelow-workflow-orchestrator/SKILL.md";
const SKILL_B = "/cache/skills/stelow-product-pricing/SKILL.md";

// --- 1. A skill read is recognised, and named. ------------------------------
assert.deepEqual(
  skillReads([skillCall(SKILL_A)]).map((read) => read.skill),
  ["stelow-workflow-orchestrator"],
  "a skill read is extracted and named by its directory, so a report can say which skill",
);
assert.equal(skillReads([skillCall(SKILL_A)])[0].bulk, false, "a single read is not a bulk read");
assert.equal(
  skillReads([skillCall("/cache/skills/a/SKILL.md /cache/skills/b/SKILL.md")])[0].bulk,
  true,
  "a call naming two skill documents is a bulk read — the shape the rule exists to catch",
);

// --- 2. Reading the repository is NOT a violation. ---------------------------
// The work requires grounding, so a check that flagged every read would be noise.
assert.deepEqual(skillReads([otherCall("/repo/src/index.ts")]), [], "reading a source file is not a skill read");
assert.deepEqual(skillReads([otherCall("/repo/README.md")]), [], "reading a document is not a skill read");
assert.deepEqual(skillReads([reasoning]), [], "a reasoning item is not a tool call");
assert.deepEqual(skillReads([]), [], "no events is no reads");

// --- 2b. Listing skill paths is not reading a skill. -------------------------
// The playbook command's OUTPUT names every skill document the current stage needs, so
// a detector matching on the serialised event reports a read for the one command this
// change tells workers to run — the sanctioned way to find the reading list would look
// like the violation. Verified against a real thread: a worker ran `bb stelow playbook`
// (exit 0) and the playbook's own output is what names the documents.
const listingCall = (command) => ({
  data: { item: { type: "toolCall", tool: "bash", arguments: { command } } },
});
assert.deepEqual(
  skillReads([listingCall(`bb stelow playbook 2>&1 | head -60`)]),
  [],
  "running the playbook is not a skill read, however many SKILL.md paths its output names",
);
assert.deepEqual(
  skillReads([listingCall("bb skill list | grep SKILL.md")]),
  [],
  "nor is listing the skills",
);
assert.deepEqual(
  skillReads([listingCall("npx skills add calionauta/stelow@x/SKILL.md")]),
  [],
  "nor is fetching one, which is a different act with its own rule",
);
assert.equal(
  firstTurnVerdict([listingCall("bb stelow playbook")]).violated,
  false,
  "so a worker that follows the instruction is not reported as violating it",
);
// The distinction is the COMMAND, not the mere presence of the word: a genuine read
// that happens to name the same file still counts.
assert.equal(
  skillReads([skillCall(SKILL_A)]).length,
  1,
  "while a real read of the same document still counts, so the exclusion is not a blanket one",
);

// --- 3. The verdict, in the two directions that matter. ----------------------
// The bulk flag travels into the verdict, not only through `skillReads`. Asserted on
// the verdict because that is the object a caller records from: a flag that exists on
// the lower-level reader and is dropped on the way up is a fact nothing uses.
const bulkVerdict = firstTurnVerdict([skillCall(`${SKILL_A} ${SKILL_B}`)]);
assert.equal(
  bulkVerdict.readsBeforeAdvance[0].bulk,
  true,
  "a bulk read is flagged in the verdict, so a caller can distinguish one call naming twelve skills from twelve calls naming one",
);

const violated = firstTurnVerdict([reasoning, skillCall(SKILL_A), skillCall(SKILL_B)]);
assert.equal(violated.violated, true, "reading skills before advancing is a violation");
assert.equal(violated.advanced, false, "and the worker had not advanced");
assert.deepEqual(
  violated.readsBeforeAdvance.map((read) => read.skill),
  ["stelow-workflow-orchestrator", "stelow-product-pricing"],
  "both reads are named, in order",
);
assert.equal(violated.skillsReadBeforeWork, 2, "the count is the number of skills read to orient");

const clean = firstTurnVerdict([reasoning, otherCall("/repo/src/index.ts"), advanceCall(), skillCall(SKILL_A)]);
assert.equal(clean.violated, false, "a skill read AFTER the advance is the legitimate case — that is when the stage's list applies");
assert.equal(clean.advanced, true, "the advance is recognised");
assert.equal(clean.readsTotal, 1, "the post-advance read is still counted in the total, just not as a violation");
assert.deepEqual(clean.readsBeforeAdvance, [], "and none of it happened before the advance");

// The ordering is what separates the two, so it is asserted rather than assumed:
// the same reads in the other order are a violation.
const reordered = firstTurnVerdict([skillCall(SKILL_A), advanceCall()]);
assert.equal(reordered.violated, true, "the same read BEFORE the advance is a violation — order is the rule, not the read");

// --- 4. An advance is recognised by its verb, not by a tool name. ------------
// The worker may run it through any shell tool, and a check keyed on the tool name
// would miss every call made a different way.
assert.equal(advancedFrom([advanceCall()]), true, "a bash advance is recognised");
assert.equal(
  advancedFrom([{ data: { item: { type: "toolCall", tool: "other", arguments: { args: ["bb", "stelow", "advance", "audit"] } } } }]),
  true,
  "an advance passed as an argument array is recognised too",
);
assert.equal(advancedFrom([otherCall("/repo/src/index.ts")]), false, "an ordinary read is not an advance");
assert.equal(advancedFrom([]), false, "no events is no advance");

// --- 5. The trail line names the skills, or it is just a complaint. ----------
const line = firstTurnTrailLine(violated, { estimatedTokens: 54000 });
assert.ok(line.includes("stelow-workflow-orchestrator") && line.includes("stelow-product-pricing"), "the line names the skills read");
assert.ok(line.includes("2 skills"), "and the count");
assert.ok(line.includes("54,000"), "and the estimated cost, when the caller has it");
assert.ok(line.includes("bb stelow playbook"), "and names the command that resolves the reading list, so the reader has a door");
assert.equal(firstTurnTrailLine(clean), null, "a worker that obeyed leaves no line — null in, null out, so a caller can record unconditionally");
assert.equal(firstTurnTrailLine(null), null, "and a missing verdict is not a violation");
assert.ok(
  !firstTurnTrailLine(violated).includes("tokens"),
  "without a token figure the line says nothing about tokens rather than estimating zero",
);

// --- 6. Duplicate reads are one skill in the line. --------------------------
// A worker re-reading the same skill twice is one orientation cost, not two, and a
// line that listed it twice would read as a bigger violation than it is.
const repeated = firstTurnVerdict([skillCall(SKILL_A), skillCall(SKILL_A)]);
assert.equal(repeated.skillsReadBeforeWork, 2, "both reads are counted");
assert.equal(
  (firstTurnTrailLine(repeated).match(/stelow-workflow-orchestrator/g) ?? []).length,
  1,
  "but the line names the skill once, because it is one skill",
);

// --- 7. Malformed events do not throw. --------------------------------------
// This runs over whatever the host recorded, and a throw would take down the pass
// that reads it.
for (const bad of [null, undefined, [null], [{}], [{ data: null }], [{ data: { item: null } }], [{ data: { item: { type: "toolCall" } } }]]) {
  assert.doesNotThrow(() => firstTurnVerdict(bad), `malformed events do not throw: ${JSON.stringify(bad)}`);
}
assert.deepEqual(skillReads([{ data: { item: { type: "toolCall", arguments: null } } }]), [], "a tool call with no arguments is not a read");

console.log(
  "first-turn contract ok: skill reads are recognised by argument, order decides the verdict, "
    + "repository reads never count, and a violation names its skills and its cost",
);
