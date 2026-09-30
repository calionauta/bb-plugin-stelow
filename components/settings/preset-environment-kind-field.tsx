import { ISOLATED_WORKTREE_LABEL } from "../isolated-worktree-check";
import { isKnownEnvironmentKind, type PresetManagerForm } from "./preset-manager-types";

const WORKTREE_KIND = "new-worktree";

export type PresetEnvironmentKindFieldProps = {
  form: PresetManagerForm;
  builtIn: boolean;
  busy: boolean;
  onChange: (next: PresetManagerForm) => void;
};

/**
 * Where a preset's cards work: an on/off control, not a "Project checkout vs
 * Worktree" pair.
 *
 * The pair is impossible to keep honest. The stored `project-default` means the
 * shared checkout in Stelow, while the composer's own default is a managed
 * worktree whenever git permits — so a card carrying a "Project checkout"
 * preset would be labelled with a different word than the control promised.
 * That is the failure this whole feature exists to remove, so the control
 * states only what it can guarantee: an on state that seeds the picker, and an
 * off state that says nothing at all.
 *
 * The label comes from the import dialog's declared single source, so the two
 * surfaces cannot drift. Its benefit and detail sentences do NOT: they describe
 * an agent and a card, and one of them tells the reader to create the very
 * preset this dialog is authoring. The sentences below are this location's own.
 */
export function PresetEnvironmentKindField({
  form,
  builtIn,
  busy,
  onChange,
}: PresetEnvironmentKindFieldProps) {
  const isolated = form.environmentKind === WORKTREE_KIND;
  const unrecognised = !isKnownEnvironmentKind(form.environmentKind);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 cursor-pointer"
          checked={isolated}
          disabled={busy || builtIn}
          onChange={(event) =>
            onChange({
              ...form,
              environmentKind: event.target.checked ? WORKTREE_KIND : "project-default",
            })
          }
        />
        <span className="text-foreground">{ISOLATED_WORKTREE_LABEL}</span>
      </label>
      <p className="text-xs text-muted-foreground">{explain(isolated, unrecognised, builtIn, form.environmentKind)}</p>
    </div>
  );
}

/**
 * One sentence per state, each saying what actually happens. The off state says
 * what BB does, not what the card will get: BB resolves its own default, and
 * that default is not this plugin's to promise.
 */
function explain(
  isolated: boolean,
  unrecognised: boolean,
  builtIn: boolean,
  kind: string,
): string {
  if (builtIn) {
    return "Built-in presets keep their own environment. Duplicate it to change this.";
  }
  if (unrecognised) {
    return `This preset stores an unrecognised environment ("${kind}"), so it is treated as BB's default. Saving rewrites it as the default environment.`;
  }
  if (isolated) {
    return "Cards start with this preset open a worktree of their own. You can still change it when creating a card.";
  }
  return "Off: cards start in whatever environment BB picks for the project.";
}