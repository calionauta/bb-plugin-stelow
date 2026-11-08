import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REVIEW_CHARS,
  contractHeadings,
  documentSections,
  selectReviewExcerpt,
} from "../lib/review-excerpt.mjs";
import { buildReviewPrompt } from "../lib/review-verdict.mjs";
import { createGatePreReview } from "../server/review-preflight.ts";
import { cliHarness, commentBodies } from "./helpers/cli-harness.mjs";

/**
 * The reviewer used to get the first 12k chars of the artifact and a note that
 * truncation happened. On a long document that is the wrong 12k: a substantial
 * introduction pushes the section the contract names past the cut, so the
 * reviewer judges a document whose required table is missing — and the note made
 * that look considered. These tests are the guard for that, and for the two
 * ways the fix goes wrong: an excerpt that silently drops the request, and a
 * fallback that pretends it read the contract.
 */

// A contract shaped exactly like the real ones in lib/explore-contracts.mjs.
const CONTRACT = {
  id: "shape-up",
  minWords: 800,
  checks: [
    { kind: "named-headings", level: null, names: ["unanswered questions", "alternatives", "problem", "solution", "Scope Table"], match: "contains" },
    { kind: "table-rows", min: 2 },
  ],
};

/** A document whose required sections sit far past the char cap. */
function longArtifact() {
  const intro = `# Proposal\n\n${"Background prose that is long and largely irrelevant. ".repeat(400)}\n`;
  return [
    intro,
    "## Unanswered questions\n- does it scale?\n",
    "## Alternatives\nOption A: build. Option B: buy.\n",
    "## Scope Table\n| scope | status |\n| --- | --- |\n| a | pending |\n",
  ].join("\n");
}

test("the contract's headings are read from the same check DSL the validator uses", () => {
  assert.deepEqual(
    contractHeadings(CONTRACT).names,
    ["unanswered questions", "alternatives", "problem", "solution", "Scope Table"],
    "named-headings names are the contract's sections",
  );
  assert.deepEqual(
    contractHeadings({ checks: [{ kind: "headings", level: 2, startsWithAny: ["Option", "Proposal"] }] }).stems,
    ["Option", "Proposal"],
    "a comparison's per-option stems are section names too",
  );
  assert.deepEqual(contractHeadings(null), { names: [], stems: [] }, "no contract yields no headings, never a throw");
});

test("a section runs to the next heading of the same or shallower level", () => {
  const text = "# One\ntext\n### Deep\ninner\n## Two\nmore\n";
  const sections = documentSections(text);
  assert.deepEqual(sections.map((section) => section.text), ["One", "Deep", "Two"], "headings are found in order");
  const one = sections.find((section) => section.text === "One");
  const deep = sections.find((section) => section.text === "Deep");
  const two = sections.find((section) => section.text === "Two");
  assert.equal(one.end, text.length, "a level-1 section runs to the end when nothing shallower follows");
  assert.equal(deep.end, two.start, "a level-3 subsection ends at the next level-2 heading");
});

test("a required section past the char cap still reaches the reviewer", () => {
  const body = longArtifact();
  assert.ok(body.length > MAX_REVIEW_CHARS, "the fixture must actually exceed the cap");
  assert.ok(
    body.indexOf("## Scope Table") > MAX_REVIEW_CHARS,
    "the required table must sit past the cut for this test to mean anything",
  );

  const excerpt = selectReviewExcerpt(body, CONTRACT);
  assert.equal(excerpt.selected, "contract", "the contract drove the selection");
  assert.ok(excerpt.text.includes("## Scope Table"), "the required section is in the excerpt");
  assert.ok(excerpt.text.includes("| a | pending |"), "and its body, not just its heading");
  assert.ok(excerpt.text.length <= MAX_REVIEW_CHARS, "the cap is still a cap");
  assert.equal(excerpt.originalChars, body.length, "the original size is reported");
  assert.deepEqual(
    excerpt.headings.slice(0, 3),
    ["Unanswered questions", "Alternatives", "Scope Table"],
    "the report names which sections were sent",
  );

  // And through the prompt builder the caller actually uses.
  const { prompt, excerpt: reported } = buildReviewPrompt({
    cardName: "C",
    request: "R",
    contractLabel: "build document (shape-up)",
    artifactContent: body,
    contract: CONTRACT,
  });
  assert.ok(prompt.includes("| a | pending |"), "the reviewer prompt carries the required section");
  assert.match(prompt, /the contract's own sections/, "the prompt says the contract drove the excerpt");
  assert.equal(reported.selected, "contract", "the caller gets the excerpt report back");
});

test("no contract, or a contract that names nothing, falls back to the head and says so", () => {
  const body = `# Doc\n\n${"x".repeat(MAX_REVIEW_CHARS + 500)}`;
  const noContract = selectReviewExcerpt(body, null);
  assert.equal(noContract.selected, "head", "without a contract the head slice is used");
  assert.equal(noContract.text.length, MAX_REVIEW_CHARS, "and it is exactly the cap");
  assert.equal(noContract.truncated, true, "the fallback is still a truncation");

  const { prompt } = buildReviewPrompt({
    cardName: "C",
    request: "R",
    contractLabel: "L",
    artifactContent: body,
    contract: null,
  });
  assert.match(prompt, /the document's first/, "the prompt names the head slice rather than implying the contract drove it");
  assert.match(prompt, /may lie past the cut/, "and warns the contract's sections may be missing");
  assert.doesNotMatch(prompt, /the contract's own sections/, "a fallback never claims to be contract-aware");
});

test("a document inside the cap is sent whole and marked as such", () => {
  const body = "## Short\n- one line\n";
  const excerpt = selectReviewExcerpt(body, CONTRACT);
  assert.equal(excerpt.selected, "whole", "a fitting document is not excerpted");
  assert.equal(excerpt.truncated, false, "and it is not marked truncated");
  assert.equal(excerpt.text, body, "byte for byte");
  const { prompt } = buildReviewPrompt({ cardName: "C", request: "R", contractLabel: "L", artifactContent: body, contract: CONTRACT });
  assert.ok(!prompt.includes("Excerpted"), "no truncation note on a whole document");
});

test("the excerpt never exceeds the cap, even when one section is enormous", () => {
  const body = `# Intro\n${"y".repeat(50)}\n## Solution\n${"z".repeat(MAX_REVIEW_CHARS * 2)}\n`;
  const excerpt = selectReviewExcerpt(body, CONTRACT);
  assert.equal(excerpt.selected, "contract", "the section matched the contract");
  assert.ok(excerpt.text.length <= MAX_REVIEW_CHARS, `excerpt must stay under the cap, got ${excerpt.text.length}`);
  assert.match(excerpt.text, /section truncated at \d+ chars/, "a section cut mid-way says so inside the excerpt");
});

/**
 * A tech plan that passes its real `spec-tech` contract AND pushes its required
 * sections past the cost cap — the shape a text pin could describe but not
 * exercise: a document long enough that the contract, not a head slice, is what
 * decides which sections the reviewer sees.
 */
function longTechPlan() {
  const intro = `# Tech plan\n\n${"Background context that is long and largely irrelevant to the gate. ".repeat(220)}\n`;
  return [
    intro,
    "## Identified Scopes\n- Retry path\n- Receipt renderer\n",
    "## Sequence\nRetry first, then the receipt.\n",
    "| Task | Done Criterion | Dependencies |",
    "| --- | --- | --- |",
    "| Retry path | Retry test passes | none |",
    "| Receipt | Receipt renders the retry | Retry path |",
    "",
  ].join("\n");
}

const WORKSPACE = "/w";
const STATE = `${WORKSPACE}/.stelow/state`;

test("the reviewer's excerpt is reported to the card, and the report names the selection", async () => {
  // A review of the contract's sections and a review of the opening are
  // different reviews; the reader of the verdict is who has to tell them apart.
  // The card comment the CLI writes is where they tell them apart, so drive the
  // real review command for both selections and read the comment it leaves.
  const [contract, head] = await withCollapsedClock(() =>
    Promise.all([contractExcerptComment(), headExcerptComment()]),
  );
  assert.match(
    contract,
    /Excerpt: the contract's sections/,
    "the CLI records the excerpt report on the card, naming the contract-driven selection",
  );
  assert.match(
    head,
    /Excerpt: the document's opening/,
    "and the report distinguishes the head slice from a contract-aware excerpt",
  );
});

/** The reviewer poll waits ten seconds between reads; a test about the excerpt
 * note collapses the clock rather than paying it. */
async function withCollapsedClock(run) {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => {
    callback();
    return { unref() {} };
  };
  try {
    return await run();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

/** A long build document whose contract names sections past the cap: the
 * contract, not a head slice, decides what the reviewer sees. */
async function contractExcerptComment() {
  const { invoke, calls } = cliHarness({
    reviewPresetId: "preset_rev",
    reviewerOutput: "Verdict: pass",
    files: {
      [`${STATE}/state.md`]: "artifacts:\n  - stage: plan\n    kind: document\n    label: tech plan\n    path: spec-tech.md\n",
      [`${WORKSPACE}/spec-tech.md`]: longTechPlan(),
    },
  });
  const result = await invoke(["review", "--artifact", "spec-tech.md"]);
  assert.equal(result.exitCode, 0, result.stderr);
  return commentBodies(calls).join("\n");
}

/** A research deliverable has no depth contract, so the head slice is used and
 * the report must say so instead of claiming contract awareness. */
async function headExcerptComment() {
  const { invoke, calls } = cliHarness({
    reviewPresetId: "preset_rev",
    reviewerOutput: "Verdict: pass",
    card: { ...cliHarnessCard(), kind: "research" },
    readiness: { ready: true, invalid: [], evidence: "verified", fingerprint: "fp" },
    strategyRounds: [{ id: "round-a", file: "round.md" }],
    researchIndex: { ok: true, content: "research index" },
    files: { [`${WORKSPACE}/round.md`]: "Round body. ".repeat(MAX_REVIEW_CHARS / 6) },
  });
  const result = await invoke(["review"]);
  assert.equal(result.exitCode, 0, result.stderr);
  return commentBodies(calls).join("\n");
}

/**
 * The gate pre-review resolves the artifact's contract too, or a pre-review of a
 * long plan would judge a head slice. Injecting `sleep` collapses the poll and
 * `reviewable` skips the depth gate, so the only thing under test is the prompt
 * the reviewer is actually spawned with.
 */
test("the gate pre-review asks the contract for the sections it reviews", async () => {
  const body = longTechPlan();
  const spawned = [];
  const runner = createGatePreReview({
    bb: {
      sdk: {
        files: { read: async () => ({ content: body }) },
        threads: {
          get: async () => ({ status: "idle" }),
          output: async () => ({ output: "" }),
        },
      },
      realtime: { publish: () => {} },
    },
    getCard: () => cliHarnessCard(),
    getReviewPresetId: () => "preset_rev",
    getPresetById: () => ({ id: "preset_rev", name: "Reviewer" }),
    presetAttachmentParams: () => ({
      providerId: "pi",
      modelId: "m",
      reasoningLevel: "low",
      permissionMode: "full",
    }),
    cardWorkspace: async () => ({ path: WORKSPACE }),
    boardFromRoot: async () => ({
      workflows: [{ id: "hash1", artifacts: [{ kind: "tech-plan", path: "spec-tech.md" }] }],
    }),
    spawnDisposable: async (args, site) => {
      spawned.push([args, site]);
      return { id: "thr_pre" };
    },
    stopThread: async () => {},
    logCardComment: () => "cmt_1",
    sleep: async () => {},
    reviewable: () => true,
  });

  await runner("card_1", "plan-gate");

  assert.equal(spawned.length, 1, "a reviewable artifact spawns exactly one pre-reviewer");
  const prompt = spawned[0][0].prompt;
  assert.match(prompt, /## Identified Scopes/, "the pre-review carries the contract's required section");
  assert.match(prompt, /the contract's own sections/, "and says the contract drove the excerpt");
});

/** The card the CLI and preflight read; the fields both paths touch. */
function cliHarnessCard() {
  return {
    id: "card_1",
    name: "checkout",
    display_name: "Checkout",
    kind: "build",
    status: "in-progress",
    activity: "running",
    project_id: "proj_1",
    workspace_kind: "project",
    dir_hash: "hash1",
    worker_thread_id: "thr_worker",
    prompt: "Make checkout work",
    intent: "feature",
    stage: "execution",
    created_at: 1_700_000_000_000,
    attachments: null,
    research_strategies: [],
    research_strategy: null,
    explore_stage: null,
  };
}

console.log("review excerpt test ok: contract-aware selection, honest fallback, reported excerpt");
