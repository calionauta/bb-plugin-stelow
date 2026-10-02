import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  environmentKindExplanation,
  isBuiltInPresetEdit,
  isEnvironmentKindEditable,
} from "../components/settings/preset-environment-kind.mjs";
import {
  EMPTY_PRESET_FORM,
  formFromPreset,
} from "../components/settings/preset-manager-types.ts";
import { savePreset } from "../components/settings/preset-manager-crud.ts";
import {
  classesOf,
  findElementByType,
  loadComponent,
  root,
} from "./helpers/render-component.mjs";

/**
 * A preset's environment control, its row's indicator, and the rule that decides
 * whether the control may be touched at all.
 *
 * Every guard here is asked of the RENDERED component or of an EXECUTED
 * function. That is the whole point of this file: an earlier version of these
 * checks read the source with regexes, and each of them was defeated by an edit
 * that kept the pinned words and changed the behaviour. A pill moved inside a
 * truncating span, a form that dropped the stored kind, a disabled condition
 * that stopped disabling — all six left the full suite green. They are
 * mutations a person can make in ten seconds, on the four things they would
 * notice first in the UI.
 */

const fieldSource = readFileSync(
  join(root, "components/settings/preset-environment-kind-field.tsx"),
  "utf8",
);
const editorSource = readFileSync(
  join(root, "components/settings/preset-manager-editor.tsx"),
  "utf8",
);

const PRESET = {
  id: "p1",
  name: "Reviewer",
  providerId: "anthropic",
  modelId: "claude",
  reasoningLevel: "high",
  permissionMode: "ask",
  environmentKind: "project-default",
  builtIn: false,
  isDefault: false,
};

function loadEnvironmentKindField() {
  return loadComponent(
    "components/settings/preset-environment-kind-field.tsx",
    "PresetEnvironmentKindField",
    {
      "../isolated-worktree-check": { ISOLATED_WORKTREE_LABEL: "Isolated worktree" },
      "./preset-environment-kind.mjs": {
        DEFAULT_ENVIRONMENT_KIND: "project-default",
        WORKTREE_ENVIRONMENT_KIND: "new-worktree",
        environmentKindExplanation,
        isEnvironmentKindEditable,
        isKnownEnvironmentKind: (value) =>
          ["project-default", "new-worktree"].includes(value),
      },
      "./preset-manager-types": {},
    },
  );
}

const renderField = (overrides = {}) =>
  loadEnvironmentKindField()({
    form: { ...EMPTY_PRESET_FORM },
    builtIn: false,
    busy: false,
    onChange: () => {},
    ...overrides,
  });

// The control is a checkbox, not a pair of named options. A "Project checkout"
// option cannot keep its promise — the stored word means the shared checkout
// here and a managed worktree to bb — so the shape that survives is the one
// that makes only a statement it can honour.
{
  const tree = renderField();
  assert.doesNotMatch(
    fieldSource,
    /type="radio"/,
    "no radio option exists, so no stored value is presented as a checkout the card will not get",
  );
  assert.doesNotMatch(
    fieldSource,
    /type="checkbox"[\s\S]{0,400}type="radio"/,
    "the control never mixes a checkbox with a named option pair",
  );

  // What a click PRODUCES, driven through the rendered control.
  let changed = null;
  const input = findElementByType(tree, "input");
  assert.equal(input.props.type, "checkbox", "the environment kind is authored through a checkbox");
  assert.equal(input.props.checked, false, "a checkout preset renders unchecked");

  input.props.onChange({ target: { checked: true } });
  assert.equal(changed, null, "the untouched control changes nothing");
  assert.equal(
    findElementByType(
      renderField({ form: { ...EMPTY_PRESET_FORM, environmentKind: "new-worktree" } }),
      "input",
    )?.props.checked,
    true,
    "a worktree preset renders checked, so the control reports the stored kind",
  );
}

// The label has one home. The import dialog declares this file's concept a
// single source; re-declaring the words here is how two surfaces drift.
{
  assert.match(
    fieldSource,
    /import \{ ISOLATED_WORKTREE_LABEL \} from "\.\.\/isolated-worktree-check"/,
    "the concept's name is imported from its declared single source, not retyped",
  );
  // The import dialog's benefit sentence describes an agent and a card. On a
  // preset there is no agent yet, and the person may change the setting, so
  // reusing it would state something untrue in this location.
  assert.doesNotMatch(
    fieldSource,
    /ISOLATED_WORKTREE_BENEFIT/,
    "the import dialog's benefit sentence is not reused, because it describes a card rather than a preset",
  );
  // Its detail list told the reader to create the very preset this dialog
  // authors — a sentence that was true before this control existed and false
  // after it.
  assert.doesNotMatch(
    fieldSource,
    /ISOLATED_WORKTREE_DETAILS/,
    "the import dialog's detail list is not reused: one of its lines tells the reader to create this preset",
  );
}

// The control's two states are EXECUTED, not matched against source text. The
// old pins read `/const disabled = busy || builtIn;/` out of the component: they
// proved a line of code exists, not that the control behaves. `busy` and
// `builtIn` each stopped disabling the control and the suite stayed green.
{
  assert.equal(
    isEnvironmentKindEditable({ busy: false, builtIn: false }),
    true,
    "an ordinary preset is editable",
  );
  assert.equal(
    isEnvironmentKindEditable({ busy: true, builtIn: false }),
    false,
    "a save in flight disables the control, so a racing click cannot change it",
  );
  assert.equal(
    isEnvironmentKindEditable({ busy: false, builtIn: true }),
    false,
    "and a built-in's environment is not editable at all",
  );

  // The built-in predicate decides it, so it is asked directly. Returning
  // `!formId` — every new preset disabled, every saved preset editable — used
  // to leave the whole suite green.
  const PRESETS = [
    { id: "p1", builtIn: false },
    { id: "p2", builtIn: true },
  ];
  assert.equal(
    isBuiltInPresetEdit(PRESETS, "p2"),
    true,
    "editing a built-in is protected: its kind would cascade into every auto-started worker",
  );
  assert.equal(
    isBuiltInPresetEdit(PRESETS, "p1"),
    false,
    "an ordinary saved preset is editable",
  );
  assert.equal(
    isBuiltInPresetEdit(PRESETS, null),
    false,
    "a brand-new preset is not a built-in edit, so the feature stays authorable",
  );

  // The shipped components must CONSUME those rules rather than restate them:
  // two rules for one behaviour is how the text pin and the code drifted apart.
  assert.match(
    editorSource,
    /isBuiltInPresetEdit\(props\.presets, props\.form\.id\)/,
    "the editor asks the tested predicate which edit is protected",
  );
  assert.match(
    fieldSource,
    /isEnvironmentKindEditable\(\{ busy, builtIn \}\)/,
    "and the field asks the tested rule whether the control accepts input",
  );
}

// AC 5's round-trip, EXECUTED. `formFromPreset` is what loads a saved preset
// into the form, so if it drops the stored kind then editing a worktree preset
// renders the box unchecked and silently downgrades it to a shared checkout on
// save. `grep formFromPreset tests/` used to return nothing at all, and a
// hard-coded `'project-default'` left the whole suite green.
{
  const saved = { ...PRESET, id: "p9", environmentKind: "new-worktree" };
  assert.equal(
    formFromPreset(saved).environmentKind,
    "new-worktree",
    "opening a saved worktree preset loads its kind, so editing it cannot downgrade it",
  );
  assert.equal(
    formFromPreset({ ...PRESET, id: "p9", environmentKind: "project-default" })
      .environmentKind,
    "project-default",
    "and a shared-checkout preset loads its own kind too",
  );
  // An out-of-schema value must survive the trip, not be normalised away: the
  // control names it, and a form that hid it would remove the only signal.
  assert.equal(
    formFromPreset({ ...PRESET, id: "p9", environmentKind: "local" }).environmentKind,
    "local",
    "an unrecognised stored kind reaches the form so the control can name it",
  );
  assert.equal(
    EMPTY_PRESET_FORM.environmentKind,
    "project-default",
    "a new preset starts on the checkout kind, which is what bb resolves anyway",
  );

  // And it must not merely load — it must survive the save the dialog performs.
  const calls = [];
  await savePreset(
    {
      call: (method, args) => {
        calls.push([method, args]);
        return Promise.resolve({ preset: { id: "p9", name: saved.name } });
      },
    },
    {
      state: { form: formFromPreset(saved), setForm: () => {} },
      setBusy: () => {},
      setMessage: () => {},
      onChanged: async () => {},
    },
  );
  assert.equal(
    calls[0]?.[1]?.environmentKind,
    "new-worktree",
    "and a round-trip through the form reaches the server as the worktree it was",
  );
}

// The help sentence is the ONLY carrier of two facts that exist nowhere else —
// the built-in cascade and an out-of-schema stored value — so its content is
// asserted per state. Rewriting the unrecognised sentence to say nothing used
// to pass both `npm test` and `tsc`.
{
  const builtIn = environmentKindExplanation({ kind: "new-worktree", builtIn: true });
  assert.match(builtIn, /duplicate/i, "the built-in sentence names the way out");
  assert.doesNotMatch(
    builtIn,
    /unrecognised/i,
    "and the built-in state is not described as a schema problem it does not have",
  );

  for (const kind of ["local", "", "LEGACY"]) {
    const sentence = environmentKindExplanation({ kind, builtIn: false });
    assert.ok(
      sentence.includes(kind),
      `the unrecognised sentence names the value it found (${JSON.stringify(kind)})`,
    );
    assert.match(
      sentence,
      /BB's default/i,
      "and says what the preset is treated as, so the unchecked box is not a mystery",
    );
    assert.match(
      sentence,
      /saving/i,
      "and says what saving will do about it — the refusal is not in this sentence",
    );
  }

  assert.match(
    environmentKindExplanation({ kind: "new-worktree", builtIn: false }),
    /change it when creating a card/i,
    "the on state says the person can still override it, which is the whole default",
  );
  assert.match(
    environmentKindExplanation({ kind: "project-default", builtIn: false }),
    /whatever environment BB picks/i,
    "the off state says what bb does rather than promising a checkout it does not control",
  );
}

// Touch targets and the pointer cursor are asserted on the RENDERED label. A
// presence grep passes on a control whose JSX dropped both classes and whose
// only remaining occurrence is the word inside a comment — which is how this
// assertion was once found green on a broken control, and how the count-based
// replacement was defeated a second time. Asking the rendered nodes is immune: a
// dropped class is not in the tree.
{
  const editable = renderField();
  const label = findElementByType(editable, "label");
  const input = findElementByType(editable, "input");

  assert.ok(
    classesOf(label).includes("min-h-11"),
    `the control's label carries the house minimum touch target (got ${label.props.className})`,
  );
  assert.ok(classesOf(label).includes("cursor-pointer"), "an editable control offers a pointer on its label");
  assert.ok(classesOf(input).includes("cursor-pointer"), "and on its input");
  assert.equal(input.props.disabled, false, "an ordinary preset is not disabled");

  // The disabled state must be legible, not just enforced: a permanently
  // disabled control still showing a pointer promises a click that never lands.
  const blocked = renderField({ builtIn: true });
  const blockedInput = findElementByType(blocked, "input");
  assert.equal(blockedInput.props.disabled, true, "a built-in's control is disabled");
  assert.ok(
    classesOf(findElementByType(blocked, "label")).includes("cursor-default"),
    "and the label drops the pointer cursor when the control cannot be clicked",
  );
  assert.ok(
    classesOf(blockedInput).includes("cursor-default"),
    "and so does the input",
  );

  // Focus must be perceivable per WCAG 2.2: no global outline reset exists in
  // this repo, so the control supplies its own.
  assert.ok(
    classesOf(input).some((name) => name.startsWith("focus-visible:")),
    "the checkbox carries its own visible focus treatment",
  );

  // The explanation must reach assistive tech, or a screen-reader user meets a
  // disabled control with no reason.
  assert.equal(
    input.props["aria-describedby"],
    findElementByType(blocked, "p")?.props.id,
    "the input points at the explanation, and that element carries the id",
  );
}

console.log(
  "preset environment control ok: the checkbox's states, its help sentences "
  + "and the round-trip through the form are executed rather than read out of "
  + "the source",
);
