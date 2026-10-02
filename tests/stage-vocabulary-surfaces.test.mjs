import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerMentionProviders } from "../server/runtime/mentions.ts";
import { stageLabel, STAGE_PRODUCES, STAGE_SEQUENCE, STAGE_SKILL, stageInfoUrl } from "../lib/workflow-vocabulary.mjs";
import { cardStatusLabel } from "../lib/card-status.mjs";
import { trackableStatusLabel } from "../lib/trackables.mjs";
import { stageAttribution, stageProduces, stageSummary } from "../lib/stage-vocabulary-surfaces.mjs";

/**
 * A stage a reader can act on, by name.
 *
 * The mention picker is the one surface where a card is chosen BEFORE it is
 * opened, so the stage in its subtitle is often the only thing that tells two
 * cards apart. That makes it load-bearing: a slug there is not a cosmetic slip,
 * it is the whole row.
 *
 * This test drives the provider the host actually registers. It is not a source
 * pin: `registerMentionProviders` hands two providers to `bb.ui`, the host calls
 * `search`, and the assertion is on the string that comes back. Reverting the
 * label to the raw slug fails it, and no amount of leaving the function in place
 * helps.
 */
function providerFixture(rows, workflows) {
  const registered = [];
  const bb = {
    ui: { registerMentionProvider: (provider) => registered.push(provider) },
    sdk: {},
  };
  registerMentionProviders(bb, {
    db: {
      prepare: () => ({
        all: (...args) => (args.length ? rows.filter((r) => r.project_id === args[0]) : rows),
      }),
    },
    loadBoard: async () => ({ workflows }),
  });
  const workflow = registered.find((p) => p.id === "workflow");
  assert.ok(workflow, "the workflow mention provider is registered");
  return (query, projectId) => workflow.search({ query, projectId });
}

// The expected subtitle is DERIVED from the catalog, not written out. An earlier
// version of this file hardcoded "Interface gate" and failed the moment that
// label was renamed — which is the wrong way round: a rename is not a
// regression, and a test that cannot survive one trains people to ignore it.
// What must never appear is the slug, so that is what the assertions name.
const STAGE = "int-gate";
const LABEL = stageLabel(STAGE);

const CARD = {
  id: "card_1",
  project_id: "project_1",
  display_name: "Useful card",
  name: "useful",
  stage: STAGE,
  status: "in-progress",
  intent: "feature",
  dir_hash: "hash_1",
};

const WORKFLOW = {
  id: "wf_1",
  name: "Useful workflow",
  stage: STAGE,
  status: "in-progress",
  appetite: "small",
  reviewMode: "auto",
  scopes: [],
};

test("a workflow mention names the stage the way the card does", async () => {
  // A board workflow's status is a TRACKABLE status (`normalizeStatus` projects
  // it to a ScopeStatus), so it is named by the trackable machine. This row and
  // the card row below sit in the SAME picker with the same shape, which is
  // exactly why an earlier version of this test pinned the raw slug as correct
  // while the card row beside it had been fixed: the inconsistency looked like
  // the spec.
  const search = providerFixture([], [WORKFLOW]);
  const [item] = await search("useful", "project_1");
  assert.equal(
    item.subtitle,
    `${LABEL} · ${trackableStatusLabel(WORKFLOW.status)}`,
    "the label the rest of the card uses",
  );
  assert.doesNotMatch(item.subtitle, new RegExp(STAGE), "and never the stored stage slug");
  assert.doesNotMatch(item.subtitle, new RegExp(WORKFLOW.status), "nor the stored trackable status");
});

test("a card mention names the stage the way the card does", async () => {
  const search = providerFixture([CARD], []);
  const [item] = await search("useful", "project_1");
  assert.equal(item.subtitle, `${LABEL} · ${cardStatusLabel(CARD.status)} · feature`);
  assert.doesNotMatch(item.subtitle, new RegExp(STAGE), "and never the stored slug");
  assert.doesNotMatch(
    item.subtitle,
    new RegExp(CARD.status),
    "and never the stored card status either — the same rule, the other axis",
  );
});

test("every stage in the catalog reaches the picker as a label, not a slug", async () => {
  // The two tests above pin ONE stage, so a catalog that gains a second
  // unlabelled path is invisible. This walks the whole catalog and asks the same
  // question of each: if a stage's label is ever its own id, the slug is on
  // screen and this fails naming the stage that did it.
  const { WORKFLOW_STAGES } = await import("../lib/workflow-vocabulary.mjs");
  const rows = WORKFLOW_STAGES.map((stage, index) => ({
    ...CARD,
    id: `card_${index}`,
    dir_hash: `hash_${index}`,
    display_name: `Card ${stage.id}`,
    stage: stage.id,
  }));
  const search = providerFixture(rows, []);
  const items = await search("card", "project_1");
  assert.equal(items.length, WORKFLOW_STAGES.length, "every stage got a row");

  for (const stage of WORKFLOW_STAGES) {
    const item = items.find((entry) => entry.title === `Card ${stage.id}`);
    assert.ok(item, `${stage.id} produced a mention row`);
    assert.doesNotMatch(
      item.subtitle,
      new RegExp(`(^| · )${stage.id}( · |$)`),
      `${stage.id} reached the picker as a slug`,
    );
  }
});

test("an unknown stage still reaches the picker rather than vanishing", async () => {
  // `stageLabel` falls back to the raw value on purpose: a card on a stage this
  // build does not know about should still be findable and still say where it
  // is. Swallowing it instead would hide the card from the only surface that
  // could introduce it to a reader.
  const search = providerFixture([{ ...CARD, stage: "stage_from_the_future" }], []);
  const [item] = await search("useful", "project_1");
  assert.match(item.subtitle, /^stage_from_the_future · /, "shown as-is, not dropped");
});

// ---------------------------------------------------------------------------
// One stage, one meaning.
//
// `STAGE_PRODUCES` and `STAGE_SKILL` had four render sites and no owner: the
// workflow map printed them, the stage-timeline chip repeated the same sentence
// in its `title` and then sent the reader to find the link "in the Workflow map
// below", and the advance dialog printed a third copy. Two surfaces answering
// one question differently is not redundancy — it is two answers.
//
// The last test is the one that matters. The defect is the absence of an owner,
// not a wrong string, so it can only be pinned by counting readers. A fifth
// reader fails there and nowhere else.
// ---------------------------------------------------------------------------

test("each stage's meaning is what the catalog says", () => {
  for (const stage of STAGE_SEQUENCE) {
    assert.equal(stageProduces(stage), STAGE_PRODUCES[stage] ?? null, `${stage} produces`);

    const attribution = stageAttribution(stage);
    const skill = STAGE_SKILL[stage] ?? null;
    if (!skill) {
      assert.equal(attribution, null, `${stage} has no owning skill`);
      continue;
    }
    assert.equal(attribution.skill, skill, `${stage} attribution skill`);
    assert.equal(attribution.url, stageInfoUrl(stage), `${stage} attribution url`);
  }
});

test("summary carries the produces sentence and never points elsewhere", () => {
  for (const stage of STAGE_SEQUENCE) {
    const summary = stageSummary(stage);
    const produces = STAGE_PRODUCES[stage] ?? null;
    const skill = STAGE_SKILL[stage] ?? null;
    if (!produces && !skill) {
      assert.equal(summary, null, `${stage} has no vocabulary to summarize`);
      continue;
    }
    assert.ok(summary, `${stage} summarizes`);
    assert.equal(summary.produces, produces, `${stage} summary produces`);
    assert.equal(summary.attribution?.skill ?? null, skill, `${stage} summary attribution`);
    if (produces) {
      assert.ok(summary.text.startsWith(produces), `${stage} text leads with what it produces`);
    }
    // The regression this module exists to remove.
    assert.doesNotMatch(summary.text, /see the .*map/i, `${stage} must not point at another component`);
    assert.doesNotMatch(summary.text, /\bbelow\b/i, `${stage} must not refer to layout it cannot see`);
  }
});

test("unknown and malformed stages answer empty rather than throwing", () => {
  for (const bad of ["", null, undefined, "not-a-stage", 42]) {
    assert.equal(stageProduces(bad), null);
    assert.equal(stageAttribution(bad), null);
    assert.equal(stageSummary(bad), null);
  }
});

/** Every source file under a directory, so a new component cannot hide from the count. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|mjs|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

test("STAGE_PRODUCES and STAGE_SKILL are read in exactly one place", () => {
  // The projection is the owner. Its own test may assert against the raw
  // catalog — that is the point of the check. Everything else must ask.
  const allowed = new Set([
    join("lib", "stage-vocabulary-surfaces.mjs"),
    join("lib", "workflow-catalog.mjs"),
    join("lib", "workflow-vocabulary.mjs"),
    join("tests", "stage-vocabulary-surfaces.test.mjs"),
    join("tests", "workflow-contracts.test.mjs"),
  ]);
  const offenders = [];
  for (const root of ["components", "lib"]) {
    for (const file of sourceFiles(join(process.cwd(), root))) {
      const rel = file.slice(process.cwd().length + 1);
      if (allowed.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      for (const symbol of ["STAGE_PRODUCES", "STAGE_SKILL"]) {
        const reads = new RegExp(`import[\\s\\S]{0,400}?\\b${symbol}\\b[\\s\\S]{0,200}?from|` + `${symbol}\\s*\\[`).test(source);
        if (reads) offenders.push(`${rel} reads ${symbol}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a stage's meaning has one owner (lib/stage-vocabulary-surfaces.mjs); a surface reading the "
    + "catalog directly is a second answer to the same question, which is how the stage timeline came "
    + "to tell readers to find the definition in another component",
  );
});
