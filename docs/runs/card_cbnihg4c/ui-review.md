---
stage: verification
task: ui-review
skill: stelow-workflow-testing-execution
workflow_id: card_cbnihg4c
mode: codebase (source review, no browser driven)
reviewed_commit: b169142
branch: bb/stelow-pq-no-modal-de-agent-presets-ao-thr_tvu6ab9qf7
reviewed_at: 2026-09-30
---

# UI review — preset environment kind

Codebase-mode UI quality audit of commit `b169142` against
`plans/spec-product.md` revision 3 and `interfaces/selected-interface.md`
(opt-3). Routing per the skill's own input table: **source code → Codebase
mode, ~80% coverage.** No browser was driven in this task — Phase 1 E2E and
the full `npm test` belong to the sibling `tests` task, so the interaction
findings below are static and each one states what a browser pass would still
need to confirm.

## Surface reviewed

| File | What it adds to the UI |
|---|---|
| `components/settings/preset-environment-kind-field.tsx` | The on/off "Isolated worktree" checkbox — the control the request was about |
| `components/settings/preset-manager-form-body.tsx` | Extracted open form body; hosts the new field |
| `components/settings/preset-manager-preset-row.tsx` | Extracted list row; hosts the new `worktree` Pill |
| `components/creation/composer-environment-seed.ts` | `useSeededComposerEnvironment` — the once-per-mount capture |
| `create-{build,research,explore}-dialog.tsx` | `defaultEnvironment` on all three creation dialogs |

## Verdict

The control keeps the promise it was designed to keep: nothing in the label
or the off state claims a checkout the card will not get, the label word is
imported from the declared single source rather than retyped, and the two
strings that would be *false* in this location are demonstrably excluded (a
`doesNotMatch` pin holds for both). The extracted components render the same
surfaces and no new border or token was introduced.

Two findings block sign-off: the state explanations are invisible to assistive
technology, and the touch-target pin is proven to survive a control that has
lost the touch-targets entirely.

## Findings

### 🚨 UIR-1 — the three state explanations are not associated with the control

`preset-environment-kind-field.tsx:55` renders the explanation as a sibling
`<p>`, outside the `<label>` that spans `:40-54`. The label wraps only the
input and the label span, so the checkbox's accessible name is
`"Isolated worktree"` and nothing more. A screen-reader user focusing the
control hears none of the sentences.

That matters more here than it would on an ordinary field, because the
approved spec made those sentences the **sole carrier** of two facts:

- `spec-product.md:276` — *"The unrecognised-value case (AC 9) is carried by
  help text alone on a bare checkbox."*
- `spec-product.md:290,294` — the built-in cascade and the unrecognised stored
  value are each carried by the help text.

So on a built-in preset, or on a row holding an out-of-enum kind, the two facts
the design deliberately removed from the visual affordance are also removed
from the accessible name. The help text is the only channel and it is
unannounced.

The house pattern for this is twenty lines away: `creation-settings.tsx:91`
(`ChoiceCards`) puts the description **inside** the `<label>`, which is why its
radio's accessible name carries the explanation.

**Fix** — either move the `<p>` inside the label as a `<span>` (matching
`ChoiceCards`), or give it an `id` and add `aria-describedby` to the input.
The second is preferable: it keeps the sentences out of the accessible name,
which is what makes them discoverable on demand rather than read every time.

### 🚨 UIR-2 — the touch-target pin passes on a control with no touch target

Two documents asked for a count, and one forbade what shipped:

- `spec-product.md:254-256` — *"the a11y pin becomes a **count to satisfy**
  (precedent: `tests/decision-routers-ui.test.mjs:89-92`) rather than an
  inherited property."*
- `testing-strategy.md:67` — *"`min-h-11` + `cursor-pointer` **counted, not
  string-matched**."*
- `AGENTS.md` — *"Copy/CSS/existence pins are banned — they pass on broken
  logic and break on refactors."*

`tests/preset-environment-seed.test.mjs:229-240` shipped
`assert.match(fieldSource, /min-h-11/)` and `assert.match(fieldSource,
/cursor-pointer/)` — presence over the whole file.

Hand-mutation, run against the real file and reverted:

```
# strip both classes from the rendered label and the input
sed -i 's/flex min-h-11 cursor-pointer items-center/flex items-center/;
        s/size-4 cursor-pointer/size-4/' preset-environment-kind-field.tsx
# leave the words behind in a comment
printf '// house rule: min-h-11 + cursor-pointer\n' >> preset-environment-kind-field.tsx

$ node --experimental-strip-types --import ./tests/register-ts-source.mjs \
      tests/preset-environment-seed.test.mjs
preset environment seed test ok: the mapping is total and reference-stable, ...
EXIT=0
```

The control lost both house classes from its actual markup and the suite
stayed green, because the words survived in a comment. This is the exact
false-green the rule exists to prevent, and it is the pin the repo's own
precedent (`decision-routers-ui.test.mjs:89-92`, which counts `h-11`
occurrences so a class-order refactor is distinguished from a dropped class)
was written to avoid.

**Fix** — count occurrences scoped to the JSX, per the precedent:

```js
assert.ok((fieldSource.match(/min-h-11/g) ?? []).length >= 1, ...);
assert.ok((fieldSource.match(/cursor-pointer/g) ?? []).length >= 2, ...);  // label + input
```

### 🤔 UIR-3 — the explicit focus treatment the spec required is absent

`spec-product.md:237` names `creation-settings.tsx:91` `ChoiceCards` as
*"viable, and the closest house style to this form"*, carrying
`focus-within:outline focus-within:outline-2 focus-within:outline-primary`.
`spec-product.md:253-254` then says the new control *"writes its own
touch-target classes **and focus treatment**"*, because the reused symbols are
plain strings and `isolated-worktree-check.tsx` has no `focus-within` at all.

`preset-environment-kind-field.tsx:40` carries no `focus-within:` and no
`focus-visible:` class. A bare `<input type="checkbox">` keeps the user-agent
focus ring and I found no global `outline: none` reset in the repository's
stylesheets, so **this is not a broken keyboard path** — the control is
reachable and visibly focused.

It is still a deviation from an explicit acceptance criterion, and it picks the
weaker of the two shapes the spec weighed. Both sibling checkbox controls
(`isolated-worktree-check.tsx:19`, `start-immediately-check.tsx:9`) also lack
it, so the field inherits the house's weaker checkbox rather than the house
style the spec selected. **Fix** or record the deviation explicitly — as
shipped, the criterion reads as satisfied and is not.

### 🤔 UIR-4 — `cursor-pointer` promises clickability while disabled

`preset-environment-kind-field.tsx:40` and `:43` apply `cursor-pointer`
unconditionally, but `:45` sets `disabled={busy || builtIn}`. On a built-in
preset the control is permanently disabled and the cursor still says otherwise.
Trivial: fold the class into the same condition, or add the muted-opacity
treatment the disabled radio rows use in `strategy-picker.tsx:70`.

### 🤔 UIR-5 — the seed is captured per panel mount, not per dialog open

`composer-environment-seed.ts:21-22` states:

> *"Reopening the dialog remounts this hook and re-reads the preset, which is
> the one moment the seed is allowed to change."*

It does not. The hook is called in `CreateBuildDialog`
(`create-build-dialog.tsx:147`), `CreateResearchDialog` (`:119`) and
`CreateExploreDialog` (`:119`) — all **above** `<Dialog>`, and all mounted once
inside the gated panel view (`build-panel.tsx:179-182`,
`research-panel.tsx:98`, `explore-panel.tsx:98`). Closing the dialog unmounts
`DialogContent`; the dialog component and its `useRef` survive. The ref
therefore re-reads only on a panel remount, which is not what the comment says
and is not what a reader would expect from the sentence.

Consequence for the requester's own scenario: a person sets a preset to
worktree in Agent Presets, then opens Create card in the same session, and the
picker does not reflect the setting they just saved until the panel remounts.

**I checked the worse variant and cleared it.** Because `BuildPanelDialogs` is
gated behind `isInitialLoad` and `boardPresets` starts as `[]`
(`build-panel-state.ts:45`), the *initial* capture happens after data loads, so
the common first-use path seeds correctly. The finding is the reopen behaviour
and the false comment, not a broken first load.

**Fix** — move the capture into a child that mounts with `DialogContent`, or
key the ref on the dialog's `open` transition. Either makes the comment true.

### 🔎 UIR-6 — three muted pills in one row, one carrying a different class of fact

`preset-manager-preset-row.tsx:34-38` renders `default`, `built-in` and
`worktree`, all with the default `Pill` tone
(`build-status-pills.tsx:15-16`). `built-in` is provenance — the person cannot
edit it; `worktree` is a behaviour they just changed. Adjacent identical pills
read as one category, and neither carries a `title`.

Separately, none has `shrink-0`, and the row is `flex items-center gap-2` where
only the actions group (`:63`) is `shrink-0`. The added third pill raises the
chance of a pill wrapping in a narrow preset dialog. Low severity — the
structural requirement that made this visible at all (sibling of the
truncating span, so it is not ellipsised away) is met and correctly pinned.

### 🔎 UIR-7 — dangling `aria-controls` when the form is collapsed (pre-existing)

`preset-manager-form-body.tsx:89` sets `aria-controls="preset-form-body"` on
the toggle, but that id exists only while open (`preset-manager-form.tsx:50`).
Confirmed pre-existing at `75bb482:preset-manager-form.tsx:47-60`: the
extraction moved it verbatim. Recorded, **not attributed to this card**.

## Nielsen heuristic scorecard

| # | Heuristic | Verdict | Note |
|---|---|---|---|
| 1 | Visibility of system status | 🟡 | Built-in / disabled states are visible visually and unexplained to AT (UIR-1) |
| 2 | Match with the real world | 🟢 | "Isolated worktree" imported from the import dialog's declared single source |
| 3 | User control and freedom | 🟡 | A saved preset kind does not reach the create dialog in the same session (UIR-5) |
| 4 | Consistency and standards | 🟢 | Same label, same touch classes, same `min-w-0 flex-1 truncate` meta treatment as before |
| 5 | Error prevention | 🟢 | Out-of-enum kind refused client-side with a sentence naming both states; `upsertPreset` never called |
| 6 | Recognition over recall | 🟡 | The worktree state is only in help text and a list Pill; discoverability is the accepted cost of opt-3 |
| 7 | Flexibility and efficiency | 🟢 | No new navigation; the field is in the form already open |
| 8 | Aesthetic and minimalist design | 🟢 | No new border, section or token; no duplicate of the single source |
| 9 | Help users recognise and recover from errors | 🟡 | Unrecognised-kind help text is unreachable to AT (UIR-1) |
| 10 | Help and documentation | 🟢 | Help text is state-specific and says what actually happens |

## Verified green

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run test:preset-ui` | green |
| `npm run test:presets` (incl. `preset-environment-seed.test.mjs`) | green |
| `tests/component-rule-seams.test.mjs` | green (rewritten exact-args pin holds) |
| `tests/card-design-tokens` / `card-surface-consistency` / `card-information-hierarchy` | green |
| `tests/suite-wiring` | 333 files wired, no orphan |
| `tests/debt-baseline` | green; both ceilings removed from `source-debt.json`, not raised |
| `npm run quality:shape` | green; no changed line over 160 chars |
| Seed shape vs SDK union | `{type:'host', workspace:{type:'managed-worktree', baseBranch:{kind:'default'}}}` is a real variant (`bb-plugin-sdk-app.d.ts:329-352`) |
| `.d.mts` indexed access | correct — `CreateThreadEnvironmentArgs` is declared at `:368` and is not in the export list |

## For the decision-maker, not a defect

The requester asked that *"quando for abrir uma issue de qq projeto, vir como
default o que foi selecionado no preset."* This card seeds the three **card
creation** dialogs (build, research, explore). The GitHub issue **import** path
is explicitly out of scope — `context_findings` records it under `IMPORT
PATH`, and `features-doc-truth` lists "any behaviour change to the GitHub
import default" as out of scope; `GithubIssuesDialog` keeps its own
`IsolatedWorktreeCheck` with an unchanged default. If "abrir uma issue" meant
the import dialog rather than creating a card, this card does not answer that
half. Worth confirming rather than assuming.

## Not covered here

Browser E2E (the skill's Phase 1) and the full `npm test` are the sibling
`tests` task. UIR-5 in particular should be confirmed in a browser: open the
create dialog, save a preset's kind, reopen, and read the picker.

## Hand-off (workflow mode)

```
stage          : verification
description    : Verification. Run full test suite, code review, UI audit, browser testing.
status         : partial
artifacts      : runs/exec_uurtj4ng/verification/ui-review.md
next-candidate : diff-gate
gate           : none
rework-on      : execution
```

`partial`: two blocking UI findings (UIR-1 accessibility, UIR-2 a
false-green pin) plus three deviations (UIR-3 missing focus treatment,
UIR-4 disabled cursor, UIR-5 seed captured per panel mount). No state file,
gate, or completion record was modified by this task.