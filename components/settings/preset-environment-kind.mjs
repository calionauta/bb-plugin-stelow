/**
 * A preset's environment kind: the two options, whether the control may be
 * touched, and the one sentence that explains the current state.
 *
 * Pure, and a module rather than part of the field component, so each rule has
 * an executor. A source-text pin can only prove a sentence is present; it
 * cannot prove the sentence a person actually reads matches the state the
 * control is in, and that correspondence is the whole point of a help line.
 */

/** The two kinds the preset schema can store. */
export const ENVIRONMENT_KINDS = ["project-default", "new-worktree"];

/** The kind a non-worktree preset stores, and what a new preset starts on. */
export const DEFAULT_ENVIRONMENT_KIND = "project-default";

/** The kind that means "open a worktree of its own". */
export const WORKTREE_ENVIRONMENT_KIND = "new-worktree";

/**
 * Whether a value is one the schema can store.
 *
 * An installed row's kind arrives as a plain string and a value outside these
 * two is genuinely reachable: upgraded installs add the column with
 * `ALTER TABLE` and no CHECK, and the CLI casts its flag blindly.
 */
export function isKnownEnvironmentKind(value) {
  return ENVIRONMENT_KINDS.includes(value);
}

/**
 * Editing a built-in keeps its own environment. Flipping the built-in default's
 * kind would re-route every auto-started worker through `firstWorktreePreset`,
 * un-park the automation gate, and become the inherited kind of every preset
 * created afterwards — a cascade so consequential that the control is disabled
 * rather than left silent.
 *
 * A new preset (`id` null) is not a built-in edit: there is nothing to protect
 * yet, and disabling every fresh form would make the feature unauthorable.
 */
export function isBuiltInPresetEdit(presets, formId) {
  if (!formId) return false;
  return presets.some((preset) => preset.id === formId && preset.builtIn);
}

/**
 * One sentence per state, each saying what actually happens. The off state says
 * what BB does, not what the card will get: BB resolves its own default, and
 * that default is not this plugin's to promise.
 *
 * The unrecognised case names the stored value and the way out, because both
 * facts exist nowhere else — the field renders unchecked and the refusal
 * happens on save.
 */
export function environmentKindExplanation({ kind, builtIn }) {
  if (builtIn) {
    return "Built-in presets keep their own environment. Duplicate it to change this.";
  }
  if (!isKnownEnvironmentKind(kind)) {
    return `This preset stores an unrecognised environment ("${kind}"), so it is treated as BB's default. Saving rewrites it as the default environment.`;
  }
  if (kind === WORKTREE_ENVIRONMENT_KIND) {
    return "Cards start with this preset open a worktree of their own. You can still change it when creating a card.";
  }
  return "Off: cards start in whatever environment BB picks for the project.";
}

/** Whether the control accepts input right now. */
export function isEnvironmentKindEditable({ busy, builtIn }) {
  return busy !== true && builtIn !== true;
}