# Interface Contrast — preset environment kind

*Readable view of `interfaces/contrast.json` (round 1), which is the source of
truth. This file decides nothing on its own; every claim below carries the
provenance recorded in the receipt.*

- **Receipt:** `interfaces/contrast.json#contrast-round-1` (schemaVersion 1)
- **Route:** `interface-refinement` — **Disposition:** `continue`
- **Authority:** `agent` (Review Mode = Auto, `review_gates: []`)
- **Shape:** `plans/spec-product.md#revision-2`
- **Scope map:** `mapId=preset-env-kind-map`, `status=approved`, same shape revision
- **Reshape proof:** none — no product commitment or new approval actor arose,
  so nothing routed back to Shape.

## Decision question

How does the Agent Presets editor expose a preset's environment kind, given that
`project-default` means a *shared checkout* in Stelow and a *managed worktree*
in bb — and given that the off state can only ever be "BB resolves its own
default", never a named checkout?

**Primary dimension:** affordance — the control shape that states, or does not
overstate, where the agent works.

**Why the job rides on it:** without an authorable kind there is no default at
all. The request's second half (issue creation pre-filled from the preset,
acceptable or changeable) has nothing to read until this field exists, so the
affordance *is* the job, not decoration on it.

## First reaction, preserved

The decision-maker asked for two options labelled **"project checkout"** and
**"worktree"** — a radio whose states are named after the two places work can
happen. That reaction is recorded before any agent synthesis and is not
overwritten by it. It is also the origin of the invalid option below, and the
reason the vocabulary finding is worth showing back to them rather than acted on
silently.

## Fixed constraints

1. **Stored vocabulary is immutable** — `environment_kind` stays
   `'project-default' | 'new-worktree'`; the column carries a CHECK constraint
   and the RPC input is `z.enum(...).default('project-default')`.
   *Source: measured — `server/preset-migrations.ts:11`,
   `server/platform-rpc-contract.ts:100`.*
2. **Vocabulary collision is real and measured** — `describeCardEnvironment`
   returns `managed` for any `{type:'project-default'}` and reaches `worktree`
   only via host + managed-worktree, so a card on the shared-checkout path is
   stored `managed`, not `shared`.
   *Source: measured — `lib/tracks.mjs:94-100`, read directly this round, not
   inherited from the spec.*
3. **Seed, never override** — `selectCardEnvironment` precedence is untouched and
   the `card-environment.mjs:1-11` invariant survives; a human pick always wins.
   *Source: `state.md` shape_decisions; scope-map `composer-seed-wiring`
   outOfScope.*
4. **Built-in presets are not editable here** — the kind control is disabled when
   `preset.builtIn`, because flipping it cascades through `firstWorktreePreset`,
   the automation gate and `defaultForm` inheritance.
   *Source: scope-map `env-kind-control`; verified reachable via
   `server/preset-lookups.ts` and `preset-manager-form-state.ts` in the spec.*
5. **No new surface, token, or design change** — the field reuses the open form
   body; a new border/section or a new type step fails the recursive design-token
   gate. *Source: scope-map `env-kind-control` outOfScope; AGENTS.md UI
   vocabulary table.*
6. **Both host files sit exactly on their debt ceilings** —
   `PresetManagerFormView` 73/73 and `PresetManagerList` 74/74, neither in
   `inheritedBaseline`, so the two extractions are mandatory in the same commit.
   *Source: measured — `scripts/source-debt.json:19-20`, re-read this round.*
7. **Touch targets and pointer are stated but untested house rules** — `min-h-11`
   on each clickable and `cursor-pointer` on the control.
   *Source: AGENTS.md State honesty, and AGENTS.md's own admission that the rule
   is "stated, not tested".*

## Criteria the options were judged against

1. Every state the reader can see is a promise the shipped code keeps — no label
   names a checkout the card will not get.
2. The control cannot be mistaken for one that does nothing; an off control must
   not read as broken.
3. Focus is perceivable per WCAG 2.2 on the chosen shape, verified in this
   repository rather than assumed.
4. The isolated-worktree vocabulary has one home, so the preset editor and the
   import dialog cannot drift.
5. A preset saved while a composer dialog is open cannot overwrite a human pick.
6. An unrecognised stored kind degrades to today's behaviour and says so, never
   throws.
7. The shape already has `min-h-11` and `cursor-pointer`, or a test is added in
   the same commit.
8. The affordance is authorable in the manager form only, never on the shared
   assign surface.

**Related dimensions carried alongside:** vocabulary and copy ownership (who
holds the words "Isolated worktree"); accessibility (focus appearance and group
semantics); module coupling (does the preset editor import the import dialog's
concept module); scope shape (does the corrected control stay inside
`env-kind-control` or redraw its boundary); test cost (which behaviour is
pin-able without mounting the host composer).

## Options

- **opt-2** (valid) — two-state radio-card, `fieldset` + `legend`, copying the
  `strategy-picker` shape, with an off-state sentence promising "Uses BB's own
  default for this project".
- **opt-3** (valid) — on/off checkbox reusing `IsolatedWorktreeCheck` and
  `ISOLATED_WORKTREE_LABEL`, with the off state left silent.
- **opt-4** (valid) — two-state radio-card built on the existing `ChoiceCards`
  house style from `creation-settings.tsx`.
- **opt-1** (invalid as a reader-facing promise) — two-option radio labelled
  "Project checkout" and "Worktree", the decision-maker's literal first
  reaction.

### opt-2 — the approved spec's choice

- Corrects the vocabulary collision by dropping "Project checkout" from the
  reader's view while keeping `project-default` in storage.
- Carries the unrecognised-kind state as a **visible third state** (neither
  option selected).
- `min-h-11` and `cursor-pointer` must be pinned by a new test, since the house
  rule is stated but untested.
- Forks the isolated-worktree vocabulary away from the module that declares
  itself its single source.

### opt-3 — the agent's recommendation

- **Eliminates the unearned-promise failure structurally** rather than by careful
  wording.
- Inherits `min-h-11` and `cursor-pointer` from `isolated-worktree-check.tsx:19-20`,
  so the stated-but-untested house rule is satisfied by construction.
- Reuses a constant that already has a consumer (`github-import-tab.tsx:113`) and
  a running test pin (`tests/card-start.test.mjs:150`).
- Creates a **visible reference cycle**: the component's help text says "Needs a
  New-worktree preset in Agent Presets", and Agent Presets would then render its
  words.
- Carries the benefit sentence, which describes a card rather than a preset, and
  has no natural home for the unrecognised-value state.

### opt-4 — the refuting option

- Refutes the premise that opt-2 is the only accessible shape, so the choice is
  presented as a choice rather than a deduction.
- Consistent with the settings surfaces the preset dialog already sits next to.
- Still needs an off-state sentence, and so carries the same inexpressible-promise
  problem as opt-2.

### opt-1 — recorded, not dropped

Not unbuildable: the storage, the RPC enum and the form union all carry it.
Invalid as a reader-facing promise — `lib/tracks.mjs:96` stores `managed` for any
`project-default`, so a card carrying a "Project checkout" preset is labelled
with a different word than the control promised. This is the exact failure the
request exists to fix, and the spec reached the same conclusion for the same
reason in critique gap 5. Recorded because it is the request's origin, and the
reader deserves to see why its words changed.

## Evidence

1. **[measured] `lib/tracks.mjs:94-100`** —
   `describeCardEnvironment({envType:'project-default'})` returns `managed`, and
   `worktree` is reached only via `workspaceType === 'managed-worktree'`. A card
   started on the shared-checkout path is therefore labelled `managed` on the
   card, while a preset labelled "Project checkout" promises a shared checkout.
   The label and the stored fact disagree for one of the two radio states, in the
   direction that costs the reader most.
2. **[measured] `components/creation/creation-settings.tsx:91`** — `ChoiceCards`,
   a third in-repo radio shape the spec's reuse analysis does not mention, carries
   `focus-within:outline focus-within:outline-2 focus-within:outline-primary` —
   the identical treatment the spec credits `strategy-picker` with, plus
   `min-h-11` and `cursor-pointer`. The approved spec's load-bearing
   justification ("the `strategy-picker` shape is the one copied, because it is
   the only one in the repo that yields WCAG 2.2 focus appearance today") is
   therefore false: at least two shapes yield it.
3. **[measured] `components/isolated-worktree-check.tsx:1-31`** — a live on/off
   affordance for exactly this concept already exists and already calls itself the
   single source: "Single source for the isolated-worktree concept: same words in
   the import dialog, the card checkout note, and the publication panel". It
   exports `ISOLATED_WORKTREE_LABEL`, uses a checkbox with `min-h-11` and
   `cursor-pointer`, and already carries the progressive-disclosure detail line.
   The spec named `strategy-picker` as the only reuse candidate and never read
   this file.
4. **[measured] `components/github/github-import-tab.tsx:113` and
   `tests/card-start.test.mjs:150`** — `IsolatedWorktreeCheck` is already mounted
   by the GitHub import tab and already pinned by a running test asserting the
   import offers "the shared isolated toggle". Reusing it in the preset editor
   would give the new control an existing consumer and an existing behavioural
   pin, at the cost of creating a visible reference cycle: that component's help
   text says "Needs a New-worktree preset in Agent Presets", and Agent Presets
   would then render its words.
5. **[measured] `components/settings/preset-manager-form.tsx:20,72`** —
   `PresetManagerFormView` renders `PresetExecutionPicker` and nothing else; no
   environment-kind control exists, and `environmentKind` is nowhere in the file.
   The reported absence is literal, not a discoverability problem.
6. **[measured] `components/settings/preset-manager-list.tsx:41,49,51`** — the
   row's meta content sits inside a `min-w-0 flex-1 truncate` span while two
   `Pill`s sit outside it, so an indicator added inside that span is ellipsised
   and never renders. The row's right edge is the only place a worktree indicator
   can honestly live.
7. **[measured] `components/settings/preset-assign-options.tsx:76-88`** — the
   spec's claim about this third radio shape is **true**: a visible
   `accent-primary` radio with no `focus-visible` or `focus-within` rule. One of
   the spec's three reuse claims was verified correct, which is why the false one
   had to be re-read rather than assumed.
8. **[scenario] AC 4 / `spec-product.md:355-360`** — for an off preset the prop is
   omitted byte-for-byte and the composer's own default applies. A control that
   must explain the off state has to explain it in terms of BB's resolution, which
   is the one thing this plugin does not control and cannot keep — the off state
   is inexpressible as a promise, only as a mechanism.
9. **[simulation] reader walk-through of opt-2 vs opt-3 on the preset form** — on
   opt-2 the reader sees two labelled cards and must read the off card's sentence
   to learn what unchecked means. On opt-3 the reader sees one labelled checkbox;
   unchecked is silent by construction, so the unearned-promise failure is not
   solved but made structurally impossible. The cost moves to discoverability:
   nothing on the row explains what off does.
10. **[simulation] AC 9 unrecognised-kind state on each shape** — a
    `fieldset`+`legend` radio can render "neither option selected" as an explicit
    third visual state with the value named in help text. A bare checkbox cannot:
    unrecognised and off are pixel-identical, so the explicit state has to be
    carried entirely by help text. This is the one criterion on which opt-3 is
    strictly worse than opt-2.
11. **[human] `sw-card_cbnihg4c` prompt (first reaction, recorded verbatim in the
    card prompt)** — the decision-maker named two options with checkout
    vocabulary. No one has yet told them that one of those two words is a promise
    the code cannot keep, so their first reaction stands as the origin of the
    request and is not the shape of the answer.
    *(Cross-reference corrected in this view: the receipt's "recorded verbatim
    above" points at the card prompt, which is not reproduced in this file.)*
12. **[human] `gate_decision` in `state.md`; `approvals/spec-product.approved.md`**
    — Review Mode is Auto with `review_gates` empty. The spec was approved by
    `llm`, and its own `claim_verification` already withdrew one unverified claim
    from critique round 1 — the precedent for re-reading rather than inheriting
    is established in this card, not imported from outside it.

## Missing evidence — carried forward, not invented

1. The decision-maker has **not** been shown that their own phrase "project
   checkout" is the unearned promise. The finding is recorded in `state.md` and
   the spec, never confirmed back to them. A copy pass at the interface gate
   should close this rather than let the change land as a silent re-labelling.
2. **No reader test distinguishes opt-2 from opt-3.** No first-reader pass has
   said whether a checkbox with a silent off state is understood as "off = BB
   decides" or read as "not set up yet". The contrast rests on structure, not on
   observed comprehension.
3. Whether the visible reference cycle created by opt-3 is acceptable to the
   person who wrote the isolated-worktree module is unasked. The cycle is a copy
   question, and the module's comment shows the words are deliberately
   centralised.

## Accepted sacrifice

Under opt-3, the preset editor's control is a **bare checkbox rather than a
grouped fieldset**: the off state gets no sentence at all, so a reader who has
never seen the form learns nothing about what off does, and the unrecognised-kind
state (AC 9) is carried by help text alone.

Both costs are accepted because the off state is the pre-existing behaviour,
because explaining it is what forced the unearned promise in the first place,
and because a card that lands where BB's own default put it is not a defect to be
warned about. The cost is paid in discoverability, deliberately, to buy a
control that cannot lie.

## Next

`scope-map.json` `env-kind-control` pins the displaced choice **by name** — its
inScope line reads "copying `components/creation/strategy-picker.tsx:64-104`, the
only in-repo radio shape yielding WCAG 2.2 focus appearance today", and that
clause is false. So this cannot be absorbed silently into the existing scope.

**Coordinator to emit `scope-map-challenge.json`** (never edit the approved map)
proposing:

- (a) keep the on/off primary value, which the evidence strengthens;
- (b) replace the copy target with `IsolatedWorktreeCheck` /
  `ISOLATED_WORKTREE_LABEL`, recording the reference cycle and the silent off
  state as named costs;
- (c) add the newly verified `ChoiceCards` focus treatment to the spec's reuse
  analysis, so the false uniqueness claim is corrected at source and not only in
  this receipt;
- (d) carry the three missing inputs into the interface gate, the first of which
  needs the decision-maker shown why "project checkout" did not survive.

Then the interface pick goes to the canonical `selection` stage. This receipt
records the contrast; it does not own the selection.

## Contract check

- Every option carries an ID, primary value, related values and compatibility —
  yes (3 valid, 1 invalid with a reason).
- Every evidence item carries provenance — yes (7 measured, 1 scenario,
  2 simulation, 2 human; 12 total, matching the receipt).
- Fixed constraints explicit — 7, each with a source. Accepted sacrifice
  explicit — yes, above.
- Shape and scope-map versions recorded — yes, in the header.
- Disposition names a valid next route — `continue` → `scope-map-challenge` then
  the canonical `selection` stage.
- Human boundary: **none this round.** The primary decision is settled by
  measured evidence and Review Mode is Auto with no review gates, so no contract
  ID, boundary ID or answer schema applies. The three missing inputs are carried
  into the interface gate rather than resolved by a live question here.
- Nothing missing was invented.
