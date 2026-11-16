---
name: preset-environment-kind
product_type: software
appetite: Complete
appetite_source: setup
appetite_fit: fits
review_mode: Auto
interface: standard
stage: shape
created_at: 2026-09-30
approved: false
generated_by: "space-bunny-free"
assumptions_resolved:
  - core_flow: "confirmed — the user reports a control that does not exist and a default that does not take effect; both halves are one field (triage, context_findings)"
  - target_user: "the single operator authoring Agent Presets and creating cards by hand; not a team, no multi-tenancy"
  - business_rules: "none — no payment, no tenancy, no invites; the only rule is precedence (seed < explicit human choice)"
  - risk_domain: "low — a wrong default costs a card in the wrong checkout, which the existing environmentFallbackNotice already names; worktree isolation is explicitly NOT a security boundary"
  - tech_hints: "TypeScript + React inside the existing bb plugin SDK surface; no new dependency, no new storage, no server contract change"
---

# Shape — "choose my checkout or my worktree once, and have it be the default"

## Reading of the intake

The request reads as one missing control. It is three decisions wearing one coat:

1. a **control** — a preset field nobody can set, so the value is only reachable by CLI flag;
2. a **vocabulary** — the two words in the requested control mean *opposite things* in the two layers this plugin spans;
3. a **precedence** — a default that seeds a picker rather than one that overrides it.

Only (3) is where a bug can hide. (1) is a form. (2) is a naming fix that decides whether the shipped control is honest.

---

## 1. 🤔 Unanswered questions and unexplored issues

- **The stored enum's name is a lie in exactly one of its two states.**
  `project-default` resolves to the *shared project checkout* (`server/workers.ts:99-101` → `host/unmanaged/path`),
  while bb's own `{type:"project-default"}` means **a fresh managed worktree** when git permits
  (server policy, commit `893a05a`, 2026-08-12). The plugin only works today because
  `new-worktree` forwards that token to bb as a delegation. A radio rendered over the raw enum is
  wrong for one of its two states, in the direction that costs most: a person who picks
  "Project checkout" and gets a worktree. **This is a decision, not a detail.**
- **The seed is asymmetric, and the asymmetry is invisible.** The SDK documents that an
  `unmanaged` workspace's `path` has no composer control — a seeded selection submits
  `path: null`. In any multi-project setup `path: null` is *not* this project's source.
  And because `path: null` is a **valid** environment, `environmentFallbackNotice` never fires.
  The divergence is completely silent. (Verified: SDK `bb-plugin-sdk-app.d.ts:2641-2667`.)
- **The re-seed rule can undo a human choice.** `default*` props are value-compared every render;
  when one changes, the composer re-seeds **every** environment selection, *including ones the user
  already touched*. In a dialog that stays mounted across a band-routing toggle, choosing a
  different preset silently overwrites an environment the person picked by hand. Whether the
  plugin accepts that or defends against it is unresolved.
- **Exploratory workspaces swallow the seed entirely.** `server/cards-create.ts:250` branches
  before `selectCardEnvironment` for `workspace.exploratory` (personal projects), so a seeded
  worktree is ignored with no notice. Build refuses those projects (`:132`); research and explore
  do not.
- **`firstWorktreePreset` is a default that nobody designed** — `ORDER BY is_default DESC, name ASC`
  (`server/preset-lookups.ts:116`). Two worktree presets today resolve alphabetically.
- **Verification gap:** `tests/component-rule-seams.test.mjs` and
  `tests/card-creator-environment-optional.test.mjs` are wired into **no** npm script. `npm test`
  will not catch a regression in either — and they are exactly the files that pin the two payloads
  this change touches.

---

## 2. 🧭 Strategic shaping alternatives

| # | Strategy | Trades away | Verdict |
|---|---|---|---|
| **A** | **Control + seed.** Add the field to the form; seed the composer's environment picker from it. | Nothing load-bearing. Costs two UI surfaces and a new pure function. | **Chosen** |
| **B** | **A + change the GitHub import default** to follow the preset. | Automation safety. Import auto-start would begin landing in worktrees where it previously parked. A parked reason is a recoverable state; an agent writing into the wrong tree is not. | Rejected this cycle |
| **C** | **A + per-project preset storage** (`project_id` on `stage_presets`). | Appetite. New column, migration, RPC, lookup rewrite, and a UI for it. | Rejected — this is the request's "para qq projeto", re-read honestly below |
| **D** | **Invert `selectCardEnvironment` precedence** so the preset wins over the composer's pick. | The `card-environment.mjs:1-11` invariant, which exists so "I picked worktree and nothing happened" can never happen silently. | Rejected — this is the trap, not the answer |
| **E** | **Delegate the seed** (`new-worktree` → `{type:"project-default"}`, i.e. keep `workers.ts:103`). | Durability. The seed's meaning is then defined by a host policy that changed six weeks ago and can change again. | Rejected for the client seed — **state the worktree, don't delegate it** |

---

## 3. 📝 Structured Shape Up proposal

### 🎯 Problem

The operator opens Agent Presets, edits a preset, and finds no control for where the agent works.
`environment_kind` exists in the schema with a `CHECK` constraint
(`server/preset-migrations.ts:11`), in the RPC input and output
(`server/platform-rpc-contract.ts:80,100`), in the form's types
(`preset-manager-types.ts:20,48`), and in the save payload
(`preset-manager-crud.ts:78`). The form body renders two controls — a name input and the execution
picker — and writes neither. The value is a write-only passthrough: loaded from the row,
round-tripped unchanged. **The only supported way to create a worktree preset is
`bb stelow preset add --workspace new-worktree`**, a flag documented in the CLI's own usage text
and absent from the UI.

A second, quieter failure sits behind it. Even with the control, the preset's kind would still not
decide anything, because `NewThreadRequest.environment` is a *required* field of the host's submit
type and all three creation dialogs forward it verbatim. `selectCardEnvironment` passes any
recognised shape through by reference, so `workerEnvironment(...)` — the only consumer of
`preset.environment_kind` at creation — is evaluated and discarded on every card started from a
composer dialog. The fallback exists. It is dead code on the main path.

A third: a worktree preset is **invisible in the list**. `preset-manager-list.tsx:44-45` prints
provider/model · reasoning · permission and drops the kind entirely, so a `new-worktree` preset is
indistinguishable from a shared-checkout one.

Impact: the person is not missing a convenience. They are missing the only UI path to a value the
product already stores, and — once stored — the only wiring that would make it mean anything.

### 💡 Solution

Three capabilities, in dependency order. The middle one is a naming fix and it gates the other two.

**1. Environment kind becomes an authorable preset field.**
A new `PresetEnvironmentKindField` component in `components/settings/`, rendered inside the
existing open form body. Two options, labelled in the reader's words rather than the enum's:
*Project checkout* and *Worktree*. It writes `form.environmentKind`, which the save path already
sends. The preset list gains one line so the value has a visible home.

It must be a **new component**, not a block inside `PresetManagerFormView`: that function is at
exactly 73 lines, its recorded ceiling in `scripts/source-debt.json:19`, and
`tests/debt-baseline.test.mjs` fails on growth. The list component is at exactly 74 against a
ceiling of 74. Both are full.

It lives in the manager form **only**, not in the shared `PresetExecutionPicker` — despite the DRY
pull. The assign dialog on a card *chooses* a preset; the manager form *authors* one. Putting an
authoring control on the assignment surface would let a card dialog mutate a globally shared row.
That is a semantic reason, not an aesthetic one, and it is why the duplication is accepted.

**2. One honest name, and state the worktree rather than delegate it.**
The stored value stays `project-default` — renaming a `CHECK`-constrained column would ripple
through a fallback seed row, a CLI flag alias (`cli-draft.ts:100-101`), and a string comparison in
`resolveEffectiveEnvKind`. What changes is the **wire mapping the client builds for the seed**:

| Preset kind (stored) | Seed sent to composer | Label the reader sees |
|---|---|---|
| `project-default` | *nothing — the prop is omitted* | Project checkout |
| `new-worktree` | `{type:"host", workspace:{type:"managed-worktree", baseBranch:{kind:"default"}}}` | Worktree |

The worktree is **stated, not delegated**. This is the load-bearing decision of the whole feature:
under the current `workers.ts:103` the preset's worktree intent is a request for bb's
`project-default`, whose meaning bb is free to redefine — as it did in `893a05a`. A seed that names
`managed-worktree` cannot be redefined underneath us.

**3. The preset seeds the composer; the composer still owns the choice.**
The three creation dialogs widen their `preset` prop type to carry `environmentKind` and pass
`defaultEnvironment` to `experimental_NewThreadComposer`. The SDK documents this prop verbatim as
*"a seed the user can change, taking precedence over the composer's own environment default when
provided"* — prefill plus human override, which is the request verbatim.

`analysisPreset` (`build-panel-state.ts:226-232`) already returns the **whole** preset row
including `environmentKind`. The field is lost one layer below, at the dialog prop types
(`create-build-dialog.tsx:134`, `create-research-dialog.tsx:110`, `create-explore-dialog.tsx:110`).
No server change, no contract change, no migration: the `environment` already rides every submit,
and `selectCardEnvironment` already honours a `managed-worktree` by reference.

**Operational rules.**
- **Seed, never override.** `selectCardEnvironment`'s precedence is untouched; the
  `card-environment.mjs:1-11` invariant survives intact.
- **The seed is a seed.** A person who changes the environment picker changes the card. The preset
  is a starting point, not a rule.
- **Asymmetry is stated, not hidden.** For *Project checkout* the prop is **omitted**, not seeded
  with `{type:"project-default"}`. The SDK says that value "seeds nothing", so passing it would
  display a control that appears to do something and does not. The field's own help line says the
  worktree option seeds the picker and the checkout option uses BB's own default.
- **The GitHub import path keeps its own default** and the copy says so where the reader is.

### ⚠️ Dangers and uncertainties

- **A default that does not take effect is worse than no default.** This is the dominant failure
  in the category (`worktree.baseRef` set and ignored in desktop sessions; `bgIsolation` with no
  effect on session creation). The seed is exactly the mechanism that can fail quietly. The
  defence: the seed only ever names a shape the composer can render, so the picker visibly opens
  on the seeded value — the reader can see it worked, and can see it didn't.
- **Re-seeding can overwrite a human choice.** If the preset changes while a dialog is mounted, the
  composer re-seeds everything, including a touched environment. Trigger: toggling band routing
  with the composer open. The plugin should stabilise the seed for the dialog's mounted lifetime
  rather than pass a value that changes underneath it.
- **Exploratory workspaces ignore the seed silently.** Trigger: starting a research or explore card
  on a personal project. `cards-create.ts:250` branches before the seed is consulted. The
  documented response is a Personal workspace, but "I set the default and it did nothing" is
  precisely the complaint being answered here.
- **`environment_label` flips.** A seeded card stores `worktree` where it previously stored
  `managed`/`shared` (`lib/tracks.mjs:94-101`). This is the intended effect and it is
  user-visible; it is also the cheapest way to tell afterwards whether the seed worked.
- **Copy becomes false the moment the control exists.** `isolated-worktree-check.tsx:13` — *"Needs
  a New-worktree preset in Agent Presets"* — tells the reader they must go elsewhere for something
  they can now make here. The **refusal** stays correct (there can still be no worktree preset);
  only the affordance is stale. `FEATURES.md:1206-1207` ("environment kind stays a preset field")
  and `FEATURES.md:1012-1013` ("Stelow never re-picks it") become false and must be rewritten in
  the same commit.
- **Test surface moves for real reasons.** `tests/preset-ui.test.mjs` pins element counts, render
  order and a hand-rolled-control ban; `tests/debt-baseline.test.mjs` pins the two LoC ceilings.
  None of these are gratuitous — each is the encoding of a rule — so each must be *re-earned*, not
  relaxed.
- **Two files that guard this path are in no test script.** A green `npm test` is not evidence.

### 🚫 Out of scope

- **Per-project preset storage** (`project_id` on `stage_presets`). The request's *"para qq
  projeto"* is answered by the preset applying in every project, which is what a global preset
  already means. Per-project is new storage, new RPC, new migration — the appetite's whole budget
  for something the request only implies.
- **Changing the GitHub import default.** The import dialog's checkbox starts unchecked; making it
  follow a preset would move unattended automation into worktrees it previously parked out of. The
  copy is corrected; the behaviour is not.
- **Changing `firstWorktreePreset`'s alphabetical tie-break.** Nobody designed it, nobody has
  complained in the repo, and it is a different feature.
- **Renaming the stored enum value.** `CHECK` constraint, fallback seed row, CLI alias, and a
  string comparison in `github-automation-gate.mjs:29` all move together for a naming gain.
- **Inverting `selectCardEnvironment`.** Destroys the "I picked worktree and nothing happened"
  guard on purpose.
- **Changing `server/workers.ts:103`.** The server-side *fallback* for non-composer callers (import,
  respawn, reseed, drafting) keeps delegating. Only the client-side seed is made explicit.

### 📋 Scope Table (OUT/IN)

Every exclusion below is deliberate: each is a feature with its own risk class, not a trim of this
one. Anything uncertain was marked OUT, per the conservative-scoping rule.

**OUT scope** — what this cycle will not do:

**IN scope** — what this cycle commits to:

| OUT | IN |
|-----|-----|
| Per-project preset storage (`project_id` column, migration, RPC) | Global preset kind that seeds every project's card composer |
| Changing the GitHub import/auto-start default | Correcting the stale "create a New-worktree preset" copy where the reader is |
| `firstWorktreePreset` tie-break redesign | `FEATURES.md:1206-1207` and `:1012-1013` rewritten in the same commit |
| Renaming the stored enum value | Honest labels ("Project checkout" / "Worktree") over the stored value |
| Inverting `selectCardEnvironment` precedence | Seed-only: `defaultEnvironment` on the composer, human override preserved |
| Changing `server/workers.ts:103` server fallback | Client seed stated as `managed-worktree`, not delegated to bb |
| Putting the control in the shared `PresetExecutionPicker` | Control in the manager form only (authoring vs assigning) |
| Defending against host re-seeding across preset changes | Accepting host re-seed semantics, recorded as a known behaviour |
| Personal/exploratory workspace seeding | A stated limitation, not a silent one |

---

## Definition of Done (Product)

- [ ] A preset's checkout/worktree kind can be set and changed entirely from the Agent Presets
      dialog, with no CLI.
- [ ] A new worktree preset is visible as such in the preset list.
- [ ] Starting a card from any of the three composer dialogs opens the environment picker already
      on the preset's worktree, and the person can accept it or pick something else.
- [ ] Picking something else in the picker always wins. The preset never overrides.
- [ ] No card ever lands in a different checkout than the one its dialog showed, with no notice.
- [ ] Copy that tells the reader a worktree preset must be created elsewhere is corrected.
- [ ] Every changed behaviour is described in `FEATURES.md` in the same commit.

## Acceptance Criteria

1. **Given** a preset whose kind is Worktree, **when** it is the active analysis preset and the
   Build dialog opens, **then** the composer's environment picker is seeded to an isolated
   worktree, and submitting untouched creates a card whose stored environment label is `worktree`.
2. **Given** a worktree preset, **when** the person changes the environment picker in the
   composer, **then** the card is created in the chosen environment and no notice is written —
   exactly as if no preset existed.
3. **Given** a preset whose kind is Project checkout, **when** a card is started from any composer
   dialog, **then** the composer's default applies unchanged — byte-for-byte today's behaviour,
   including the environment picker showing whatever it shows today.
4. **Given** a preset being edited, **when** the form opens, **then** the field shows that
   preset's current kind, and saving without touching the field round-trips the value unchanged
   (a built-in worktree preset is not silently converted to a checkout preset).
5. **Given** a saved worktree preset, **when** the preset list renders, **then** the row is
   distinguishable from a checkout preset without opening it.
6. **Given** a card started on a personal/exploratory project, **when** the preset is a worktree
   preset, **then** the environment the card lands in is the exploratory workspace's — and this is
   a recorded, stated limitation rather than an assumption the UI made.
7. **Given** a build/research/explore dialog whose preset changes while mounted, **when** the
   composer re-seeds, **then** either the seed is stable for the dialog's lifetime or the
   behaviour is recorded in `FEATURES.md` as accepted host semantics.
8. **Given** the import dialog, **when** it is opened for a project, **then** the isolated
   worktree default is unchanged (unchecked) and the copy no longer implies the preset can only be
   created elsewhere.

---

## Rabbit holes (timeboxed, do not become scope)

- **R1** — Does the composer render a `managed-worktree` seed for a project whose source is a
  non-Git directory, and what does it submit? *Spike: read `WorktreePicker` behaviour; fall back
  to seeding nothing and saying so.*
- **R2** — Exact re-seed trigger surface. *Spike: confirm whether a value-stable seed
  (computed once per dialog mount) is enough to avoid overwriting a touched environment.*
- **R3** — Whether research/explore on a personal project should hide the control rather than
  ignore it. *Spike; default to documenting.*

## Test shape (behaviour, never literals)

Per `AGENTS.md` ("no bullshit tests"), pin **what is written and what is submitted**:

- what the form control writes into `form.environmentKind`;
- what `upsertPreset` receives (extend `tests/component-rule-seams.test.mjs:184-187`'s exact-args
  pin, and note that file is in no npm script — wire it in);
- what `defaultEnvironment` the composer receives **per preset kind, including the omitted case**;
- that `selectCardEnvironment` is unchanged, and that a seeded worktree that *is* honoured produces
  no notice;
- that `environmentFallbackNotice` still fires on a real substitution.

A test grepping the form for the literal `new-worktree` would pass on broken logic and break on the
vocabulary fix. Per `AGENTS.md`'s circular-validation rule, this suite is authored by a fresh
subagent given the requirements alone.

---

## appetite_fit

`fits`. Complete appetite asks for 8–15 scopes, 3–5 compared strategies, and full edge-case
mapping. This shape compares five strategies (§2), maps the named edge cases
(exploratory workspaces, re-seeding, seed asymmetry, label flip, stale copy, untested files), and
carries nine IN items against nine OUT items. No cut is proposed: each OUT is a separate feature
with its own risk class, not a trim of this one.

The one thing Complete would normally add — 5 interface archetypes — is bounded by `review_mode:
Auto`, which removes the interface gates and lets the LLM decide. The interaction here is a
two-option field inside an existing open form, and the repo's vocabulary rules
(`SECTION_SURFACE`/`DisclosureSection`, named type steps, `min-h-11`) largely determine its shape
already.

```
stage          : shape
description    : Shape stage. Define appetite, hill chart, rabbit holes.
status         : done
artifacts      : runs/exec_q8bt01c3/recon/shape.md
next-candidate : critique
gate           : none
rework-on      : shape
```
