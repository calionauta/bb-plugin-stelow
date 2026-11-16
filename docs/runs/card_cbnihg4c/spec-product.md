---
appetite: Complete
appetite_source: setup
review_mode: Auto
review_mode_source: setup
product_type: software
domains_detected: []
name: preset-environment-kind
appetite_fit: fits
revision: 3
revised_by: "critique round 1 (7 critical gaps), then planning alignment (5 findings + 1 note)"
assumptions_resolved:
  - "core_flow: confirmed - the user reports a control that does not exist and a default that does not take effect; both halves are one field (triage + context_findings in state.md)."
  - "target_user: the single operator authoring Agent Presets and creating cards by hand; not a team, no multi-tenancy."
  - "business_rules: none - no payment, no tenancy, no invites; the only rule is precedence (seed < explicit human choice)."
  - "risk_domain: low - a wrong default costs a card in the wrong checkout, which the existing environmentFallbackNotice already names; worktree isolation is explicitly NOT a security boundary."
  - "tech_hints: TypeScript + React inside the existing bb plugin SDK surface; no new dependency, no new storage, no server contract change."
  - "SCOPE READING of 'para qq projeto': answered by a global preset applying in every project, which is what a global preset already means. Per-project storage is a separate feature and is OUT."
  - "PRECEDENCE: seed, never override. selectCardEnvironment is untouched, so the card-environment.mjs:1-11 invariant survives. Inverting precedence is the trap, not the answer."
  - "VOCABULARY: the stored value stays project-default (a CHECK-constrained column with a fallback seed row, a CLI alias and a string comparison all depend on it). What changes is the wire mapping the client builds for the seed, and the labels the reader sees."
  - "IMPORT PATH: the GitHub import default is unchanged in this scope; its copy is corrected instead."
  - "CRITIQUE GAP 1 RESOLVED: the claim that two guard files are wired into no npm script was FALSE. package.json test:contracts invokes both and npm test chains test:contracts; tests/suite-wiring.test.mjs fails the build on any unwired test. DoD 7, AC 9, the test-shape wiring clause and the OUT/IN row are deleted. The real work is extending the already-running exact-args pin."
  - "CRITIQUE GAP 2 RESOLVED: both host files sit at their exact ceilings and neither is in inheritedBaseline, so editing either trips debt-baseline. The plan now extracts PresetManagerFormBody and PresetManagerPresetRow and lowers both ceilings in the same commit, rather than assuming the extraction alone suffices."
  - "CRITIQUE GAP 3 RESOLVED: host re-seed overwriting a touched picker is committed-against, not documented. The seed is computed once per dialog mount (module-level frozen constants plus a seeded-once ref), so a preset saved while the composer is mounted cannot overwrite a human pick."
  - "CRITIQUE GAP 4 RESOLVED: DoD 5 previously contradicted AC 6. DoD 5 now carries the exploratory carve-out word for word, and the silent substitution is stated in FEATURES.md rather than implied noticed."
  - "CRITIQUE GAP 5 RESOLVED: the label 'Project checkout' promised what the code does not keep, because omitting the seed lets BB resolve its own default (which may be a managed worktree) and such a card is stored 'managed'. The control is inverted to an explicit on/off toggle whose OFF state makes no promise."
  - "CRITIQUE GAP 6 RESOLVED: making a built-in preset's kind editable cascades unbounded (firstWorktreePreset, the automation gate, and inheritance by every later preset via defaultForm). The kind control is DISABLED for built-ins; renaming/duplicating remains available."
  - "CRITIQUE GAP 7 RESOLVED: the environment_label change is a permanent per-path divergence, not a one-time flip. describeCardEnvironment returns 'managed' for any project-default and 'worktree' only for host+managed-worktree, so non-composer starters keep the old label forever. Restated as a per-path divergence and accepted with the trigger named."
  - "ALIGNMENT F1 RESOLVED (rev 3): the Interaction-states table still described the two-option radio this card rejected, nine lines below its own 'not a two-option radio' sentence. An executor reading that table would have rebuilt the unearned promise. Rewritten to the opt-3 checkbox; the 'Empty' row replaced by the real unrecognised-value case, which is genuinely reachable because PresetManagerPreset.environmentKind is typed string and formFromPreset casts it unchecked."
  - "ALIGNMENT F2 RESOLVED (rev 3): 'min-h-11 + cursor-pointer inherited by construction' was FALSE. The reused symbols are plain strings; the classes live on the label inside the component, and isolated-worktree-check.tsx has no focus-within at all. Reuse narrowed to ISOLATED_WORKTREE_LABEL; the benefit and details strings are excluded because both are FALSE in the preset editor (no agent or card exists yet, and the details line would tell the reader to create the preset they are creating). Touch classes and focus treatment are written by hand and pinned as a count."
  - "ALIGNMENT F3 RESOLVED (rev 3): 'add both to inheritedBaseline' was backwards. inheritedBaseline is a literal expected-output list in tests/debt-baseline.test.mjs:39 compared against gate stdout, not a waiver registry. The extraction makes the inherited set SHRINK; the two parent ledger entries move to their new sizes or are deleted if the remainder fits. Nothing is added."
  - "ALIGNMENT F4 RESOLVED (rev 3): the test-shape clause said 'extend' a pin this card invalidates. tests/component-rule-seams.test.mjs:158-161 uses environmentKind 'local', which is not in the enum, so the pin currently asserts that an out-of-enum kind REACHES the rpc - the opposite of AC 10. The pin is rewritten, not extended, and the invalid-kind case is a separate refusal assertion."
  - "ALIGNMENT F5 RESOLVED (rev 3): AC 11 is a documentation criterion wearing a behaviour costume. defaultForm() already inherits the kind today, so it is reclassified and no regression test is written for unchanged behaviour."
  - "ALIGNMENT F6 NOTED: the two test-file counts (332 vs 334) differ by a glob, not a disagreement. Recorded so it is not re-litigated."
selected_by: llm
approval_receipts:
  - stage: shape
    contract: assumptions-auto-resolved
    mode: Auto
    reason: "review_gates is empty and review_mode is Auto, so this gate is not selected. The LLM decides, records the assumptions above, and advances. No human ask is parked."
  - stage: critique
    contract: critique-gap-resolution
    mode: Auto
    reason: "All 7 critical gaps are resolved in revision 2 above, each with the repository evidence re-verified directly by the coordinator before acceptance."
quality: production
---

# Spec — Preset environment kind: authorable, visible, and the composer's seed

*Revision 3. The seven critical gaps from critique round 1 and the five
findings from the planning alignment check are resolved inline; each resolution
names the repository evidence that forced it. Revision 3 changed no IN/OUT row,
no scope, no dependency and no acceptance threshold — it makes the document
agree with the repository it describes.*

*A note worth recording: three of the alignment findings survived critique round
1. That round audited whether the claims were true; it did not check whether
they were true **of this file**. The interaction-states table had described the
control this card decided not to build, in the same document that three other
places correctly forbade.*

## 1. Unanswered questions and unexplored issues

*Kept as a live section rather than a solved one: an item here is a decision
this card did not make, and a reader should be able to see which those are.*

- **Does a preset's kind belong to the *composer* at all, or to the card?** This
  card chose the composer, because a person creating a card is the one who can
  see the project they are about to touch. The alternative — resolving at card
  creation from the preset alone — is what `selectCardEnvironment` already does
  for non-composer callers, and it is why the seed is additive rather than
  exclusive.
- **Should the *server* fallback ever stop delegating?** `server/workers.ts:103`
  still forwards bb's `project-default` for non-composer callers. Making it
  state `managed-worktree` would remove the vocabulary collision from the
  server too, at the cost of changing behaviour for import, CLI, restart and
  respawn paths that this card deliberately does not touch.
- **Should `describeCardEnvironment` prefer the preset's intent over the
  submitted shape?** That would collapse the per-path label divergence, and it
  touches stored card state read by the open card. Out of scope; recorded.
- **What should the assign dialog show?** A card's "Change preset…" dialog
  chooses among presets and still hides which kind each one carries, so a person
  picking a worktree preset there learns nothing until the card runs. That is
  an inconsistency this card knowingly leaves.
- **Is a silent off state discoverable enough?** A first-reader pass has not
  distinguished "off = BB decides" from "not set up yet". The contrast rests on
  structure, not on observed comprehension.

## 2. Strategic shaping alternatives

Five strategies were compared. Each rejection below names what it costs, so a
later reader can tell a considered decision from an unexamined one.

| # | Strategy | Trades away | Verdict |
|---|---|---|---|
| **A** | **Control + seed.** Make the field authorable; seed the composer from it. | Nothing load-bearing. Costs two UI surfaces, one pure module, and two extractions. | **Chosen** |
| **B** | A + make the GitHub import default follow the preset. | Automation safety. Unattended auto-start would begin landing in worktrees where it previously parked. A parked draft is recoverable; an agent writing into the wrong tree is not. | Rejected this cycle |
| **C** | A + per-project preset storage (`project_id` on `stage_presets`). | Appetite. A new column, migration, RPC and lookup rewrite, plus a UI for it. | Rejected — see the scope reading of *"para qq projeto"* |
| **D** | Invert `selectCardEnvironment` so the preset beats the composer's pick. | The `card-environment.mjs:1-11` invariant, whose whole purpose is that "I picked worktree and nothing happened" can never happen silently. | Rejected — this is the trap, not the answer |
| **E** | Delegate the seed (keep `workers.ts:103`'s delegation on the client too). | Durability. The seed's meaning would then be defined by a host policy that changed once already, in `893a05a`. | Rejected for the client seed — state the worktree, do not delegate it |

## 3. Problem

The operator opens Agent Presets, edits a preset, and finds no control for where
the agent works. `environment_kind` exists in the schema with a `CHECK`
constraint (`server/preset-migrations.ts:11`), in the RPC input and output
(`server/platform-rpc-contract.ts:80,100`), in the form's types
(`preset-manager-types.ts:20,48`), and in the save payload
(`preset-manager-crud.ts:78`). The form body renders two controls — a name
input and the execution picker — and writes neither. The value is a write-only
passthrough: loaded from the row, round-tripped unchanged. **The only supported
way to create a worktree preset is `bb stelow preset add --workspace
new-worktree`**, a flag documented in the CLI's own usage text and absent from
the UI.

A second, quieter failure sits behind it. Even with the control, the preset's
kind would still not decide anything on the main path, because
`NewThreadRequest.environment` is a *required* field of the host's submit type
and all three creation dialogs forward it verbatim. `selectCardEnvironment`
passes any recognised shape through by reference, so `workerEnvironment(...)` —
the sole consumer of `preset.environment_kind` on that path — is evaluated and
discarded on every card started from a composer dialog.

A third: a worktree preset is **invisible in the list**.
`preset-manager-list.tsx:41-47` prints provider/model · reasoning · permission
and drops the kind entirely, so a `new-worktree` preset is indistinguishable
from a shared-checkout one without opening it.

## The vocabulary finding that gates the other two

The two words in the requested control mean **opposite things** in the two
layers this plugin spans:

- Stelow's `environment_kind = 'project-default'` means **the shared project
  checkout** (`server/workers.ts:99-101` → `host / unmanaged / path`).
- bb's own `{ type: "project-default" }` means **a fresh managed worktree** when
  git permits (host policy, commit `893a05a`, 2026-08-12).

The plugin's `new-worktree` path works *only* through that inversion:
`workers.ts:103` forwards `{type:"project-default"}` and bb resolves it to a
worktree. A control labelled "Project checkout vs Worktree" over the raw enum
is therefore wrong for one of its two states, in the direction that costs most.

## Solution

Three capabilities, in dependency order. The middle one is a naming fix and it
gates the other two.

### 1. Environment kind becomes an authorable preset field

A new `PresetEnvironmentKindField` component in `components/settings/`,
rendered inside the existing open form body. It writes `form.environmentKind`,
which the save path already sends.

**The control is an explicit on/off toggle, not a two-option radio.** Gap 5 is
the reason and it is the load-bearing UI decision in this revision. The spec's
first draft paired the stored value `project-default` with the reader-facing
label "Project checkout" while deliberately omitting the seed for that option.
The SDK documents what omission yields: *"`{ type: "project-default" }` seeds
nothing; the composer resolves its own default"* — and BB's own default is a
managed worktree whenever git permits (`893a05a`). Such a card is stored
`managed` by `lib/tracks.mjs:96`, not `shared`. The reader would see "Project
checkout" on the preset and a different word on the card: precisely the failure
this request exists to fix.

So the field states only what it guarantees:

| Control state | Seed sent to composer | What the label promises |
|---|---|---|
| **Isolated worktree: off** | *nothing — the prop is omitted* | "Uses BB's own default for this project" — **no checkout claim** |
| **Isolated worktree: on** | `{type:"host", workspace:{type:"managed-worktree", baseBranch:{kind:"default"}}}` | "Opens the picker already on a worktree you can change" |

The worktree is **stated, not delegated**. Under the current `workers.ts:103`
the preset's worktree intent is a request for bb's `project-default`, whose
meaning bb is free to redefine. A seed that names `managed-worktree` cannot be
redefined underneath us.

**Built-ins are excluded** (gap 6). Edit renders unconditionally for built-ins
(`preset-manager-list.tsx:63-70`; the `!preset.builtIn` guard at `:71` covers
Delete only), and the update branch writes every field of a built-in row
(`preset-handler-crud.ts:89-96`) while refusing only rename/duplicate/delete
(`:23-30`). Flipping the built-in default's kind would therefore re-route every
auto-started GitHub worker through `firstWorktreePreset`
(`preset-lookups.ts:114-120`), un-park the automation gate
(`lib/github-automation-gate.mjs:25-30`), and — via `defaultForm`
(`preset-manager-form-state.ts:68-72`) — become the inherited kind of every
preset created afterwards. The kind field is `disabled` for built-ins, with the
reason in the field's help text. Rename and duplicate stay available.

**Two extractions are required, not optional** (gap 2). `PresetManagerFormView`
is recorded at 73 and `PresetManagerList` at 74
(`scripts/source-debt.json:19-20`), and the gate's own header comment states
that a carried oversized function "surfaces as inherited **the moment the file
is edited**". A new component still costs an import line plus one JSX line, and
the list indicator costs at least one line — so editing either file puts its
oversized function in the changed set.

An earlier revision of this document said to *add the extracted functions to
`inheritedBaseline`*. **That was backwards and is withdrawn.**
`inheritedBaseline` is a literal expected-output list in
`tests/debt-baseline.test.mjs:39`, compared against what the diff-scoped gate
prints; it is not a waiver registry. The extracted functions will be *under* 50
lines — that is the entire point of extracting them — so they print nothing, and
adding them fails the comparison. The honest formulation is the gate header's
own: **the extraction is what makes the inherited set shrink.** The two parent
entries in `scripts/source-debt.json` move to their new sizes, or are deleted
outright if the remainder fits the 50-line budget
(`tests/debt-baseline.test.mjs:224` rejects an entry that stopped being
oversized, and a ceiling that is not `> 50` is invalid). Nothing is added to
`inheritedBaseline`.

**The list indicator must not land inside `truncate`.** The row's meta content
sits inside `<span className="min-w-0 flex-1 truncate">` (`preset-manager-list.tsx:41`),
and `truncate` is `white-space: nowrap` — a second line there is ellipsised and
never renders. The row's right edge already holds two `Pill`s (`:48-51`) and a
`shrink-0` button group. The indicator is a `Pill` rendered **only** when
`environmentKind === 'new-worktree'` (absence reads as off), and the row owns
this fact.

The control lives in the manager form **only**, not in the shared
`PresetExecutionPicker`. The assign dialog on a card *chooses* a preset; the
manager form *authors* one. Putting an authoring control on the assignment
surface would let a card dialog mutate a globally shared row. That is a
semantic reason, not an aesthetic one.

**Reuse candidate, corrected** (gap: affordance). This section originally
claimed `strategy-picker` was *the only* in-repo shape yielding WCAG 2.2 focus
appearance. **That was false and is withdrawn** — interface-contrast round 1
found, and the coordinator re-read directly, that
`components/creation/creation-settings.tsx:91` (`ChoiceCards`) carries the
identical `focus-within:outline focus-within:outline-2
focus-within:outline-primary` treatment *plus* `min-h-11` and `cursor-pointer`.
For the record, the three in-repo shapes:

| Shape | Focus treatment | Verdict |
|---|---|---|
| `strategy-picker.tsx:64-104` — sr-only radio, fieldset + sr-only legend | `focus-within:outline-2 focus-within:outline-primary` | viable |
| `creation-settings.tsx:91` `ChoiceCards` — visible radio in a bordered label | identical, plus `min-h-11` + `cursor-pointer` | **viable, and the closest house style to this form** |
| `preset-assign-options.tsx:64-93` — visible `accent-primary` radio | **none** | not viable |

The **concept's name** is reused rather than re-invented.
`components/isolated-worktree-check.tsx` is a live exported single source for
exactly this concept (`ISOLATED_WORKTREE_LABEL` at `:8`), already mounted by
the import dialog (`github-import-tab.tsx`) and already pinned by a running test
(`tests/card-start.test.mjs:150`). Reusing the **constant** means the preset
editor and the import dialog cannot drift on the words.

**The reuse is narrowed to what is actually true.** Reusing the string constant
inherits *words*, not classes — and a claim in an earlier revision of this
document that `min-h-11` + `cursor-pointer` come "by construction" was **false**
and is withdrawn. `ISOLATED_WORKTREE_LABEL`, `ISOLATED_WORKTREE_BENEFIT` and
`ISOLATED_WORKTREE_DETAILS` are plain strings (`:8-14`); the classes live on the
`<label>` *inside* the component (`:19`), and `isolated-worktree-check.tsx`
contains **no** `focus-within` treatment at all. So the new control writes its
own touch-target classes and focus treatment, and the a11y pin becomes a *count
to satisfy* (precedent: `tests/decision-routers-ui.test.mjs:89-92`) rather than
an inherited property.

Two strings are deliberately **not** reused, each for a reason that is about
truth rather than taste:

- **`ISOLATED_WORKTREE_BENEFIT`** — *"The agent works on a separate copy — your
  files and branches stay untouched"* is **false in the preset editor**. There
  is no agent and no card yet; it is a default a future card *may* take, which
  the person may change. The preset editor writes its own sentence.
- **`ISOLATED_WORKTREE_DETAILS[2]`** — *"Needs a New-worktree preset in Agent
  Presets — without one the card parks with an explanation"* rendered **inside**
  Agent Presets instructs the reader to go create the thing they are currently
  creating. That is a sentence false in its new location, which is the
  `AGENTS.md` state-honesty rule rather than a stylistic disagreement.

**Two costs remain, named and accepted**: the preset editor's control is not
the import dialog's component (one owns a preset, the other owns an import —
they share a name, not a surface), and the **silent off state**, which is
precisely what makes the unearned promise structurally impossible (nothing is
claimed, so nothing can be unearned) at the price of discoverability. The
unrecognised-value case (AC 9) is carried by help text alone on a bare
checkbox, where a fieldset could have shown "neither option selected" as a third
visual state. That is the one criterion on which a grouped control is strictly
better, and it is the cost paid for a control that cannot lie. Extracting a
shared radio primitive from `ChoiceCards` remains **OUT** this cycle.

**Interaction states** (gap: affordance), for the **checkbox** this spec
selected — *not* a two-option radio, which revision 2 of this document
accidentally still described and which the planning alignment check caught:

| State | Behaviour |
|---|---|
| Element | one `<input type="checkbox">` inside one `<label>` — the `IsolatedWorktreeCheck` shape, minus the parts this location cannot carry |
| Checked | `true` / `false`; **not** "exactly one option". The off state is silent by construction |
| Disabled | `disabled={busy}` while a save is in flight, and the control is disabled entirely when `preset.builtIn`, with the cascade named in its help text |
| Focus order | the label, then the checkbox — no group and no legend |
| Hover/active | plain Tailwind utilities; no new token |
| Loading | **N/A** — the field loads no async state |
| Unrecognised stored value | the real empty case, and genuinely reachable: `PresetManagerPreset.environmentKind` is typed `string` and `formFromPreset` casts it unchecked. The control renders unchecked, the help text names the unrecognised value, and the seed mapping treats it as `off` |
| Touch | `min-h-11` on the label, `cursor-pointer` on label and input — written by hand, not inherited (see below) |

No new surface is introduced: the field reuses `PresetExecutionPicker`'s house
style and existing type steps, so the recursive design-token gate sees no new
token.

### 2. One honest name, and state the worktree rather than delegate it

The stored value stays `project-default`. What changes is the wire mapping the
client builds for the seed — stated in the table above. For the *off* state the
prop is **omitted**, not seeded with `{type:"project-default"}`, because the SDK
documents that value as seeding nothing; passing it anyway would display a
control that appears to do something and does not.

The mapping is one pure function in `lib/` —
`presetKind → CreateThreadEnvironmentArgs | undefined` — using **indexed
access** to the environment type rather than importing an unexported name, so
each kind's behaviour is unit-testable in isolation. It is **total**: an
unrecognised stored kind maps to `undefined`, which is exactly today's
behaviour, not a throw.

### 3. The preset seeds the composer; the composer still owns the choice

The three creation dialogs widen their `preset` prop type to carry
`environmentKind` and pass `defaultEnvironment` to
`experimental_NewThreadComposer`. The SDK documents this prop verbatim as
*"a seed the user can change, taking precedence over the composer's own
environment default when provided"* — prefill plus human override, which is the
request verbatim.

`analysisPreset` (`build-panel-state.ts:226-232`) already returns the **whole**
preset row including `environmentKind`. The field is lost one layer below, at
the dialog prop types (`create-build-dialog.tsx:134`,
`create-research-dialog.tsx:110`, `create-explore-dialog.tsx:110`). No server
change, no contract change, no migration: the `environment` already rides every
submit, and `selectCardEnvironment` already honours a `managed-worktree` by
reference.

**The seed is stabilised per dialog mount** (gap 3, committed rather than
documented). The trigger is reachable in-product: `openPresets`
(`components/panels/build-panel.tsx:145`) opens the preset manager *without*
closing the create dialog (`build-panel-dialogs.tsx:88-102`), a save runs
`onChanged → state.load()` replacing `data.boardPresets`, so `analysisPreset`
returns a new kind under a live composer — and the SDK re-seeds **every**
environment selection, including touched ones
(`bb-plugin-sdk-app.d.ts:2608-2625`). The mapping returns a **module-level
frozen constant** per kind (not a fresh object literal per render) and the
dialogs capture it once with a seeded-once ref, so reference stability holds
for the dialog's mounted lifetime. DoD 4 therefore survives contact with the
host's re-seed rule.

**Operational rules.**

- **Seed, never override.** `selectCardEnvironment`'s precedence is untouched.
- **The seed is a seed.** A person who changes the picker changes the card.
- **The asymmetry is stated, not hidden.** The help line says the on-state
  seeds the picker and the off-state uses BB's own default for the project.

## Dangers and uncertainties

- **A default that does not take effect is worse than no default.** The defence
  is structural: the seed only ever names a shape the composer can render, so
  the picker visibly opens on the seeded value — the reader can see it worked,
  and can see it didn't.
- **`environment_label` diverges per path, permanently** (gap 7, restated).
  `describeCardEnvironment` (`lib/tracks.mjs:94-100`) returns `managed` for any
  `{type:"project-default"}` (`:96`) and reaches `worktree` only for `host` +
  `managed-worktree` (`:97`). Composer-started cards therefore store `worktree`;
  paths that never set an environment — GitHub/auto import
  (`github-automation-rules.ts:145`), CLI split (`cli-split.ts:255`), research
  fan-out (`research-fanout.ts:102`) — take the
  `selectCardEnvironment(undefined, workerEnvironment(...))` branch
  (`cards-create.ts:250-252`) and store `managed`. **Same preset, two labels,
  permanently.** Accepted this cycle, with the trigger named, rather than
  silently shipping it as a "flip". Whether the label should prefer the preset's
  intent over the submitted shape is a separate question with its own blast
  radius (`describeCardEnvironment` feeds stored card state), and is OUT.
- **The server fallback is live, not dead** (gap: flow). `workerEnvironment`
  remains the sole consumer of `preset.environment_kind` on every path that
  sends no explicit environment — including every restart/respawn of a card
  with no live worker (`server/workers.ts:194-205`, reached from `fresh()` at
  `:299-301`), so a card parked in the Bucket and started later, or a preset
  swap via `refreshRestartPending` (`preset-handler-assignments.ts:60-77`).
  None of those writes a substitution notice; the only notice site is
  create-time and it returns early for exploratory workspaces
  (`cards-create-persist.ts:118-122`). `server/workers.ts:103` stays unchanged,
  and the consequence is recorded rather than left to be discovered.
- **Exploratory workspaces ignore the seed silently.**
  `server/cards-create.ts:250` branches before the seed is consulted, and the
  notice writer bails first for exploratory cards. Carved out of DoD 5 word for
  word (gap 4) and stated in `FEATURES.md` as *silent*, not noticed.
- **An omitted kind silently downgrades a worktree preset.** The RPC input
  carries `.default("project-default")`, so a client that omits the field turns
  a worktree preset into a checkout preset with no refusal. Minor gap; handled
  by always sending the field explicitly and pinning it in the contract test.
- **A raw schema error is the wrong error.** The RPC input is
  `z.enum([...])` (`platform-rpc-contract.ts:100`), so an out-of-enum value is
  refused at host validation and `savePreset` writes `error.message` verbatim
  into the single message line (`preset-manager-crud.ts:88`) — against the
  one hand-written refusal in the same function, *"Name is required."*
  (`:64-67`). The kind is validated client-side with a reader-facing sentence
  naming both states; the enum and the `CHECK` stay as defence in depth, and an
  invalid-kind case asserts the RPC is never called.
- **Copy that is only *incomplete*, not false.** The first draft claimed
  `isolated-worktree-check.tsx:13` tells the reader to go elsewhere. It does
  not — it reads *"Needs a New-worktree preset in Agent Presets — without one
  the card parks with an explanation instead of starting in your checkout"*, which
  names Agent Presets as the place and **stays true**. Only
  `FEATURES.md:1012-1013` ("environment, branch forwarded unchanged; Stelow
  never re-picks it") genuinely becomes incomplete, and
  `FEATURES.md:1206-1207` ("environment kind stays a preset field") becomes an
  under-description. The same sentence is echoed at
  `github-issue-flow.ts:213,232`, `github-rule-rpcs.ts:91`,
  `lib/github-automation-gate.mjs:34` and
  `github-automation-tab.tsx:76`, with
  `tests/server-github-issue-flow.test.mjs:108,127` pinning two of those
  strings exactly — so the edit list is enumerated, not summarised.
- **The list grows a row inside a capped scroll box** (`max-h-56 overflow-auto`,
  `preset-manager-list.tsx:30`). Accepted; the indicator is inline on the row,
  not a new block, so no fade hook is adopted.

## Out of scope

Each exclusion is a feature with its own risk class, not a trim of this one.

### Scope Table

| OUT | IN |
|-----|-----|
| Per-project preset storage (`project_id` column, migration, RPC) | Global preset kind that seeds every project's card composer |
| Changing the GitHub import/auto-start default | Enumerated copy edits at the five echoed "create a New-worktree preset" sites |
| `firstWorktreePreset` tie-break redesign | `FEATURES.md:1012-1013` and `:1206-1207` rewritten in the same commit |
| Renaming the stored stored enum value | An on/off toggle whose off-state makes no promise |
| Inverting `selectCardEnvironment` precedence | Seed-only: `defaultEnvironment` on the composer, human override preserved |
| Changing `server/workers.ts:103` server fallback | Client seed stated as `managed-worktree`, not delegated to bb |
| Putting the control in the shared `PresetExecutionPicker` | Control in the manager form only (authoring vs assigning) |
| Extracting a shared radio primitive from `strategy-picker` | Copying the strategy-picker focus shape, extraction deferred |
| Making `describeCardEnvironment` prefer preset intent | The per-path label divergence recorded as a named known behaviour |
| Editing a built-in preset's kind | The control disabled for built-ins, with the cascade named in the help text |
| Showing the kind in the card assign dialog | — |
| Personal/exploratory workspace seeding | The carve-out stated in DoD 5 and `FEATURES.md` as *silent* |

## Definition of Done (Product)

- [ ] A preset's worktree kind can be set and changed entirely from the Agent
      Presets dialog, with no CLI.
- [ ] A new worktree preset is visible as such in the preset list, without
      opening it.
- [ ] Starting a card from any of the three composer dialogs with a worktree
      preset opens the environment picker already on the worktree, and the
      person can accept it or pick something else.
- [ ] Picking something else in the picker always wins, including when the
      preset is saved while the dialog is open. The preset never overrides.
- [ ] No card lands in a different checkout than the one its dialog showed with
      no notice — **except** on a personal/exploratory project, where the
      environment is the exploratory workspace's and the substitution is silent
      (recorded in `FEATURES.md` as a known limitation, not as a notice).
- [ ] The off-state label promises only "BB's own default for this project".
- [ ] The kind control is disabled for built-in presets and says why.
- [ ] `FEATURES.md:1012-1013` and `:1206-1207` are rewritten, and the five
      echoed copy sites are updated, in the same commit.
- [ ] Every changed behaviour is described in `FEATURES.md` in the same commit.

## Acceptance Criteria

1. **Given** a preset whose kind is worktree, **when** it is the active analysis
   preset and the Build dialog opens on a Git-backed project, **then** the
   composer's environment picker is seeded to an isolated worktree, and
   submitting untouched creates a card whose stored environment label is
   `worktree`. (Conditional on a Git source — see AC 6.)
2. **Given** a worktree preset, **when** the person changes the environment
   picker in the composer, **then** the card is created in the chosen
   environment and no notice is written — exactly as if no preset existed.
3. **Given** a worktree preset, **when** the preset is saved while the create
   dialog is open, **then** the composer does **not** re-seed and the person's
   already-chosen environment survives.
4. **Given** a preset whose kind is off, **when** a card is started from any
   composer dialog, **then** the prop is omitted and the composer's default
   applies unchanged — byte-for-byte today's behaviour. The label claims no
   checkout.
5. **Given** a preset being edited, **when** the form opens, **then** the field
   shows that preset's current kind, and saving without touching the field
   round-trips the value unchanged.
6. **Given** a project whose source is not a Git repository, **or** whose card
   is started on a personal/exploratory project, **when** a worktree preset is
   active, **then** the environment the card lands in is not the seeded
   worktree — BB falls back to its own default host per the documented SDK
   behaviour, and the substitution is **silent**. Recorded, not noticed.
7. **Given** a saved worktree preset, **when** the preset list renders, **then**
   a `worktree` indicator is visible on the row, and no indicator is rendered
   for a preset with the kind off.
8. **Given** a built-in preset, **when** its edit form is open, **then** the
   kind control is disabled and the help text names the cascade it would cause.
9. **Given** a stored kind outside the two known values, **when** the form
   opens, **then** the field renders an explicit unrecognised state and the seed
   mapping treats it as off — today's behaviour — rather than throwing.
10. **Given** an invalid kind submitted from the client, **when** the save is
    attempted, **then** a reader-facing refusal is shown and the RPC is never
    called.
11. **Given** a worktree preset, **when** "New preset" is opened, **then** the
    new form inherits the default preset's kind. *(This already ships — see
    `preset-manager-form-state.ts` `defaultForm()` cloning the whole form from
    the default preset — so it is a **documentation** criterion: record the
    inheritance in `FEATURES.md`. Do not write a regression test for behaviour
    this card does not change.)*
12. **Given** the import dialog, **when** it is opened for a project, **then**
    the isolated worktree default is unchanged (unchecked) and the copy no
    longer implies the preset can only be created elsewhere.

## Rabbit holes (timeboxed, do not become scope)

- **R1** — *Deleted.* It re-asked what the SDK already answers at
  `bb-plugin-sdk-app.d.ts:2645-2647`: *"A host environment whose host no longer
  exists — or whose project has no source on it — falls back to the composer's
  default host."* That behaviour is now AC 6, stated rather than spiked.

## Test shape (behaviour, never literals)

Per `AGENTS.md` ("no bullshit tests"), pin **what is written and what is
submitted**. Both guard files named in critique round 1 are **already wired**
(`package.json` `test:contracts`, which `npm test` chains, and
`tests/suite-wiring.test.mjs` fails the build on any unwired test) — verified
directly, and the claim of orphaned coverage is withdrawn.

- what the form control writes into `form.environmentKind`, and that the field
  is disabled for built-ins;
- what `upsertPreset` receives — the existing exact-args pin at
  `tests/component-rule-seams.test.mjs:184-187` is **rewritten, not extended**.
  Its fixture at `:158-161` uses `environmentKind: "local"`, which is **not in
  the enum** (`server/platform-rpc-contract.ts:100` is
  `z.enum(["project-default","new-worktree"])`), so today the pin asserts that
  an out-of-enum kind *reaches* the RPC — the opposite of AC 10. The fixture
  moves to a valid kind, the exact-args assertion is preserved, and the
  invalid-kind case becomes a **separate refusal assertion** (one reader-facing
  message, RPC never called) rather than a second row in the same object.
  `permissionMode: "ask"` at `:160` is also out of enum and is **left alone**:
  this card validates the kind only;
- what `defaultEnvironment` the composer receives **per preset kind, including
  the omitted case**, asserted on the pure mapping function, plus the
  unrecognised-kind case;
- that the seeded value is reference-stable across re-renders (the re-seed
  defence), so AC 3 is testable without mounting the host composer;
- that `selectCardEnvironment` is unchanged, and that a seeded worktree that
  *is* honoured produces no notice;
- that `environmentFallbackNotice` still fires on a real substitution;
- interaction states per the table above: `disabled={busy}`, the built-in
  disabled condition, and a `min-h-11` + `cursor-pointer` count on the new
  control.

A test grepping the form for the literal `new-worktree` would pass on broken
logic and break on the vocabulary fix — it pins the one thing this spec says is
wrong. Per `AGENTS.md`'s circular-validation rule, this suite is authored by a
fresh subagent given the requirements alone.

## Sources

- `runs/exec_c9qjbaf3/recon/setup.md` — repository recon
- `runs/exec_x0ctpt5p/strategic/context.md` — strategic context, vocabulary finding
- `runs/exec_q8bt01c3/recon/shape.md` — shape recon, IN/OUT and test shape
- `critiques/critique-report.md` — critique round 1, 7 critical gaps
- `bb-plugin-sdk-app.d.ts:2608-2667` — `defaultEnvironment` seed semantics and
  the re-seed rule, re-verified directly by the coordinator before this
  revision
- `package.json` `test:contracts` + `tests/suite-wiring.test.mjs` — the withdrawn
  coverage claim, verified directly