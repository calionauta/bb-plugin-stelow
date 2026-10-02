/**
 * What a stage means, per surface, derived once.
 *
 * `STAGE_PRODUCES` and `STAGE_SKILL` had four render sites and no owner: the
 * workflow map printed them, the stage-timeline chip repeated the same sentence
 * in its `title` and then told the reader to go find the link *somewhere else*
 * ("see the Workflow map below"), and the advance dialog printed a third copy.
 * Two surfaces answering the same question differently is not redundancy — it is
 * two answers, and the reader cannot tell which one the card believes.
 *
 * This module is the owner. Every surface asks here and gets a derived answer
 * shaped for what it can actually show:
 *
 *   - `stageProduces(stage)` — the one sentence "what this stage produces".
 *   - `stageAttribution(stage)` — who defines it, with the link already built.
 *   - `stageSummary(stage)` — both, for a surface that has room and no link.
 *
 * The pointer text is gone on purpose. A surface that cannot render a link must
 * not tell the reader to find one elsewhere; it shows the sentence, and the
 * surface that owns the link is the one that shows it. `stage-vocabulary-surfaces.test.mjs`
 * pins the single-reader property that keeps this from growing a fifth site.
 */
import { STAGE_PRODUCES, stageInfoUrl, stageSkill } from "./workflow-vocabulary.mjs";

/** Sentence explaining what a stage produces, or null when the catalog is silent. */
export function stageProduces(stage) {
  if (typeof stage !== "string" || !stage) return null;
  return STAGE_PRODUCES[stage] ?? null;
}

/**
 * The stage's owning skill and its link, as a pair.
 *
 * Returned together on purpose: a surface that renders one without the other is
 * the case that produced this module (a bare skill name with no link, plus a
 * sentence pointing somewhere else). Null when the stage has no owning skill.
 */
export function stageAttribution(stage) {
  if (typeof stage !== "string" || !stage) return null;
  const skill = stageSkill(stage);
  if (!skill) return null;
  return { skill, url: stageInfoUrl(stage) };
}

/**
 * Everything one surface needs to answer "what is this stage", in the order a
 * reader meets it: what it produces, then who defines it.
 *
 * `attribution` is null for a stage with no owning skill, so a caller can test
 * it instead of string-building a dangling clause. Used by the workflow map and
 * the stage-timeline chip title.
 */
export function stageSummary(stage) {
  const produces = stageProduces(stage);
  const attribution = stageAttribution(stage);
  if (!produces && !attribution) return null;
  return {
    produces,
    attribution,
    /** Pre-joined for a surface that renders plain text and no link. */
    text: [produces, attribution ? `Defined by ${attribution.skill}.` : null].filter(Boolean).join(" "),
  };
}
