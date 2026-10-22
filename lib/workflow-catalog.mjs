import catalog from "../data/stelow-stage-catalog.json" with { type: "json" };

function validateCatalog(value) {
  if (value?.version !== 2 || !Array.isArray(value.phases) || !Array.isArray(value.stages)) {
    throw new Error("invalid Stelow stage catalog");
  }
  return value;
}

const validated = validateCatalog(catalog);

/** Canonical stage list. The single STAGE_CATALOG definition: every other
 * module projects from here, never redefines it. */
export const STAGE_CATALOG = Object.freeze(validated.stages);
export const WORKFLOW_PHASES = Object.freeze(validated.phases);
export const WORKFLOW_ROUTES = Object.freeze(validated.routes ?? {});
/**
 * The phase each manual entry checkpoint belongs to, read from the routes.
 *
 * The catalog used to publish this map twice — once at the top level and
 * once inside `routes` — and this module read the top-level copy. Two copies
 * of one map is two owners of a fact, and upstream has now removed the
 * duplicate: the canonical place is `routes.entry_stages`, next to the rest
 * of the host-neutral projection. Reading the copy that upstream publishes
 * once is the whole fix.
 */
export const PHASE_ENTRY_STAGES = Object.freeze(WORKFLOW_ROUTES.entry_stages ?? {});
export const WORKFLOW_STAGES = Object.freeze(validated.stages.map((stage) => ({
  id: stage.id,
  label: stage.label,
  phase: stage.phase,
  skill: stage.skill,
  doc: stage.playbook,
  docSkill: stage.playbook_skill ?? stage.skill,
  produces: stage.produces,
  execution: stage.execution,
})));

export const STAGE_SEQUENCE = Object.freeze(validated.stages.map(({ id }) => id));
export const STAGE_BY_ID = Object.freeze(Object.fromEntries(validated.stages.map((stage) => [stage.id, stage])));
export const STAGE_LABELS = Object.freeze(Object.fromEntries(validated.stages.map(({ id, label }) => [id, label])));
export const STAGE_PRODUCES = Object.freeze(Object.fromEntries(validated.stages.map(({ id, produces }) => [id, produces])));
export const STAGE_SKILL = Object.freeze(Object.fromEntries(validated.stages.map(({ id, skill }) => [id, skill])));
export const STAGE_DOC = Object.freeze(Object.fromEntries(validated.stages.map(({ id, playbook }) => [id, playbook])));
export const PHASE_LABELS = Object.freeze(Object.fromEntries(validated.phases.map(({ id, label }) => [id, label])));

/**
 * Transition targets per stage, projected from the canonical catalog.
 * The advance path reads this, never transitions.md prose.
 */
export const STAGE_TRANSITIONS = Object.freeze(
  Object.fromEntries(
    validated.stages.map((stage) => [
      stage.id,
      Object.freeze({
        next: Object.freeze([...(stage.transitions?.next ?? [])]),
        accept: Object.freeze([...(stage.transitions?.accept ?? [])]),
        reject: Object.freeze([...(stage.transitions?.reject ?? [])]),
        rework: Object.freeze([...(stage.transitions?.rework ?? [])]),
      }),
    ]),
  ),
);
