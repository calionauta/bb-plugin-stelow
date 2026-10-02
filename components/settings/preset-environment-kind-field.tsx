import { ISOLATED_WORKTREE_LABEL } from "../isolated-worktree-check";
import {
  DEFAULT_ENVIRONMENT_KIND,
  environmentKindExplanation,
  isEnvironmentKindEditable,
  WORKTREE_ENVIRONMENT_KIND,
} from "./preset-environment-kind.mjs";
import type { PresetManagerForm } from "./preset-manager-types";

const HELP_ID = "preset-environment-kind-help";

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
 * preset this dialog is authoring. The help sentence below is this location's
 * own, and it comes from `preset-environment-kind.mjs` so it can be tested
 * against the state the control is actually in.
 */
export function PresetEnvironmentKindField({
  form,
  builtIn,
  busy,
  onChange,
}: PresetEnvironmentKindFieldProps) {
  const isolated = form.environmentKind === WORKTREE_ENVIRONMENT_KIND;
  const editable = isEnvironmentKindEditable({ busy, builtIn });
  // A pointer cursor on a permanently disabled control promises a click that
  // will never land. `cursor-default` is what makes the state legible without a
  // second visual treatment.
  const cursor = editable ? "cursor-pointer" : "cursor-default";
  return (
    <div className="flex flex-col gap-1">
      <label className={`flex min-h-11 ${cursor} items-center gap-2 text-xs text-muted-foreground`}>
        <input
          type="checkbox"
          className={`size-4 ${cursor} focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
          checked={isolated}
          disabled={!editable}
          // The help sentence is the only carrier of the built-in cascade and
          // the out-of-enum value, so it must reach assistive tech. A
          // described-by keeps it OUT of the accessible name, so the control
          // is announced as "Isolated worktree" and the explanation is read on
          // demand — rather than folding a sentence into the name.
          aria-describedby={HELP_ID}
          onChange={(event) =>
            onChange({
              ...form,
              environmentKind: event.target.checked
                ? WORKTREE_ENVIRONMENT_KIND
                : DEFAULT_ENVIRONMENT_KIND,
            })
          }
        />
        <span className="text-foreground">{ISOLATED_WORKTREE_LABEL}</span>
      </label>
      <p id={HELP_ID} className="text-xs text-muted-foreground">
        {environmentKindExplanation({
          kind: form.environmentKind,
          builtIn,
        })}
      </p>
    </div>
  );
}