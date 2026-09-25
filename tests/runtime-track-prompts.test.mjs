import assert from "node:assert/strict";
import test from "node:test";
import { RESEARCH_STRATEGIES } from "../lib/research-strategies.mjs";
import { TECHNIQUE_CATALOG } from "../lib/stage-catalog.mjs";
import { createTrackPrompts } from "../server/runtime/track-prompts.ts";
import { createTrackCapabilities } from "../server/runtime/track-capabilities.ts";

const PROTOCOLS = {
  cardOwnerRules: "OWNER-RULES",
  doneProtocol: "DONE-PROTOCOL",
  reviewProtocol: "REVIEW-PROTOCOL",
  draftProtocol: "DRAFT-PROTOCOL",
};

const RESEARCH_BASE = {
  displayName: "Pricing landscape",
  prompt: "How do teams price AI agents?",
  strategyLabel: "Pricing",
  strategyId: "pricing",
  strategySkill: "stelow-product-pricing",
  stateDirText: "/repo/.stelow/2026-09-25/abc",
  workspaceRoot: "/repo",
  instructions: "Be terse.",
  flavor: "initial",
  previousThreadId: "thr_abc",
  roundNo: 1,
  roundStamp: "20260925-1015",
  roundFile: ".stelow/x/rounds/pricing-r1.md",
};

const EXPLORE_BASE = {
  displayName: "Shape up pricing",
  prompt: "Shape up a pricing change.",
  stage: { id: "shape-up", label: "Shape Up", skill: "stelow-workflow-shape-up" },
  stateDirText: "/repo/.stelow/2026-09-25/abc",
  workspaceRoot: "/repo",
  instructions: "",
  flavor: "initial",
  previousThreadId: null,
};

test("the research prompt writes the canonical index shape and the round file", () => {
  const { researchWorkerPrompt } = createTrackPrompts(PROTOCOLS);
  const prompt = researchWorkerPrompt(RESEARCH_BASE);
  assert.match(prompt, /# Research index: Pricing landscape/);
  assert.match(prompt, /## Outputs\n\s*\| Strategy \| Round \| Output \| Artifact \| Notes \|/);
  assert.match(prompt, /## Opportunities\n\s*### Pricing — <today's YYYY-MM-DD date>/);
  assert.match(prompt, /<workspaceRoot>\/\.stelow\/x\/rounds\/pricing-r1\.md/);
  assert.match(
    prompt,
    /pricing-<substep-slug>-r1-20260925-1015\.md/,
    "fan-out substeps keep the real strategy id in their canonical file name",
  );
  assert.doesNotMatch(prompt, /undefined-<substep-slug>/, "an undefined input never reaches a worker path");
  assert.ok(prompt.includes("OWNER-RULES"), "the card-owner clause comes from the host const");
  assert.ok(prompt.includes("DONE-PROTOCOL"));
  assert.ok(prompt.includes("REVIEW-PROTOCOL"), "paid review stays opt-in prose, not an action");
  assert.ok(prompt.includes("DRAFT-PROTOCOL"));
  assert.ok(!prompt.includes("Run `bb stelow done`"), "the done prose lives in the const only");
});

test("each research flavor states what changed about this run", () => {
  const { researchWorkerPrompt } = createTrackPrompts(PROTOCOLS);
  assert.match(researchWorkerPrompt({ ...RESEARCH_BASE, flavor: "initial" }), /fresh research task/);
  assert.match(researchWorkerPrompt({ ...RESEARCH_BASE, flavor: "append" }), /APPEND a new ### section/);
  assert.match(researchWorkerPrompt({ ...RESEARCH_BASE, flavor: "restart" }), /CONTINUE the research/);
  assert.match(
    researchWorkerPrompt({ ...RESEARCH_BASE, flavor: "reseed" }),
    /start the research over with a fresh research-index\.md/,
  );
});

test("a previous worker thread is offered as context only when there is one", () => {
  const { researchWorkerPrompt, exploreWorkerPrompt } = createTrackPrompts(PROTOCOLS);
  const withThread = researchWorkerPrompt(RESEARCH_BASE);
  assert.match(withThread, /Previous worker thread: thr_abc \(archived\)/);
  assert.match(withThread, /bb thread output thr_abc/);
  const without = researchWorkerPrompt({ ...RESEARCH_BASE, previousThreadId: null });
  assert.ok(!without.includes("Previous worker thread"), "a first run invents no archive to read");
  assert.ok(!exploreWorkerPrompt(EXPLORE_BASE).includes("Previous worker thread"));
});

test("the explore prompt pins one artifact file and forbids the build pipeline", () => {
  const { exploreWorkerPrompt } = createTrackPrompts(PROTOCOLS);
  const prompt = exploreWorkerPrompt(EXPLORE_BASE);
  assert.match(prompt, /<state-dir>\/explore-shape-up\.md/);
  assert.match(prompt, /stage: explore/);
  assert.match(prompt, /there is no triage, no Shape Up pipeline, no stage machine, no gates/);
  assert.match(prompt, /Do NOT run the build workflow skills/);
  assert.match(prompt, /label: Shape Up/);
  assert.ok(!prompt.includes("Run `bb stelow done`"), "the done prose lives in the const only");
});

test("the explore prompt preserves its standalone restart and artifact contract", () => {
  const { exploreWorkerPrompt } = createTrackPrompts(PROTOCOLS);
  const restarted = exploreWorkerPrompt({ ...EXPLORE_BASE, flavor: "restart" });
  assert.match(restarted, /CONTINUE — do not start over unless it is empty/);
  const reseeded = exploreWorkerPrompt({ ...EXPLORE_BASE, flavor: "reseed" });
  assert.match(reseeded, /run the stage again from scratch/);
  const withThread = exploreWorkerPrompt({ ...EXPLORE_BASE, previousThreadId: "thr_explore" });
  assert.match(withThread, /If the artifact is thin/);
  assert.match(withThread, /bb thread output thr_explore/);
  for (const clause of ["OWNER-RULES", "DONE-PROTOCOL", "REVIEW-PROTOCOL", "DRAFT-PROTOCOL"]) {
    assert.ok(withThread.includes(clause), `explore receives ${clause} from the host protocol`);
  }
});

test("preset instructions are prefixed only when the preset supplies them", () => {
  const { exploreWorkerPrompt } = createTrackPrompts(PROTOCOLS);
  const withInstructions = exploreWorkerPrompt({ ...EXPLORE_BASE, instructions: "Be terse." });
  assert.match(withInstructions, /Preset instructions:\nBe terse\./);
  assert.ok(
    !exploreWorkerPrompt(EXPLORE_BASE).includes("Preset instructions"),
    "an empty instruction block is not rendered as a header",
  );
});

test("the capability index exposes the synced strategy and technique catalogs", () => {
  const caps = createTrackCapabilities();
  assert.deepEqual(caps.researchIds(), RESEARCH_STRATEGIES.map((entry) => entry.id));
  assert.deepEqual(caps.exploreIds(), TECHNIQUE_CATALOG.map((entry) => entry.id));
  assert.equal(caps.researchStrategy("pricing").id, "pricing");
  assert.equal(caps.exploreStage("shape-up").id, "shape-up");
  assert.equal(caps.researchStrategySkill("pricing"), "stelow-product-pricing");
  assert.deepEqual(caps.exploreTechnique("shape-up"), {
    skill: "stelow-workflow-shape-up",
    artifactFile: "explore-shape-up.md",
  });
});

test("an unknown track id is refused, never invented", () => {
  const caps = createTrackCapabilities();
  assert.equal(caps.researchStrategy("no-such-strategy"), null);
  assert.equal(caps.exploreStage("no-such-technique"), null);
  assert.equal(caps.researchStrategySkill("no-such-strategy"), null);
  assert.equal(caps.exploreTechnique("no-such-technique"), null);
});

test("capability lookups read the live catalog, not a startup snapshot", () => {
  const caps = createTrackCapabilities();
  const injected = { id: "injected-strategy", label: "Injected", skill: "skill-x" };
  RESEARCH_STRATEGIES.push(injected);
  try {
    assert.ok(caps.researchIds().includes("injected-strategy"), "a merged strategy is visible immediately");
    assert.equal(caps.researchStrategySkill("injected-strategy"), "skill-x");
  } finally {
    RESEARCH_STRATEGIES.pop();
  }
  assert.equal(caps.researchStrategy("injected-strategy"), null, "the injected entry is gone again");

  const injectedTechnique = { id: "injected-stage", label: "Injected Stage", skill: "skill-y" };
  TECHNIQUE_CATALOG.push(injectedTechnique);
  try {
    assert.ok(caps.exploreIds().includes("injected-stage"));
    assert.equal(caps.exploreStage("injected-stage").label, "Injected Stage");
    assert.deepEqual(caps.exploreTechnique("injected-stage"), {
      skill: "skill-y",
      artifactFile: "explore-injected-stage.md",
    });
  } finally {
    TECHNIQUE_CATALOG.pop();
  }
  assert.equal(caps.exploreStage("injected-stage"), null, "the injected technique is gone again");
});
