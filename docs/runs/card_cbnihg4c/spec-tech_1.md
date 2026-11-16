---
stage: planning
name: preset-environment-kind
product_type: software
appetite: Complete
review_mode: Auto
spec_product: plans/spec-product.md#revision-3
scope_map: scope-map.json#preset-env-kind-map
selected_interface: interfaces/selected-interface.md#opt-3
detected_at: 2026-09-30
---

# Tech plan — preset environment kind

Derived from `plans/spec-product.md` revision 3, the approved `scope-map.json`,
and `interfaces/selected-interface.md` (opt-3). Stack facts are from
`plans/stack-research.md`; the per-scope test contract is from
`plans/testing-strategy.md`.

## Executive Summary

Seven typed scopes deliver one feature: a preset's environment kind becomes
authorable in the Agent Presets dialog, becomes visible in the preset list, and
seeds the card composer's environment picker — which the person can still
change. The design is deliberately **minimal on the server**: no RPC change, no
migration, no new storage. `listPresets` already returns `environmentKind`,
`upsertPreset` already accepts it, and `analysisPreset` already returns the
whole preset row. Everything missing is on the client, plus two extractions the
size gate forces.

Three constraints shape the sequence, and each is a hard gate rather than a
preference:

1. **The two host functions sit exactly at their debt ceilings**, so
   `form-extractions` must land *before or with* any edit to them, or
   `tests/debt-baseline.test.mjs` turns the build red.
2. **The type is unexported.** `CreateThreadEnvironmentArgs` is a local alias
   over an unexported zod schema (`bb-plugin-sdk-app.d.ts:368`); the mapper's
   `.d.mts` must use indexed access — concretely
   `NonNullable<NewThreadComposerProps["defaultEnvironment"]>` — because
   `NewThreadComposerProps` *is* exported (`:3026`) and the alias is not.
3. **`lib/` is hand-paired**: a new module is an `.mjs` **plus** a matching
   `.d.mts`. That is house convention (198 `.mjs`, 196 paired declarations),
   not an optional extra.

## Identified Scopes

| # | Scope | Type | Depends on | Target |
|---|---|---|---|---|
| 1 | `env-seed-mapper` | feature | — | `lib/`, new pair |
| 2 | `form-extractions` | refactor | — | the two preset manager files |
| 3 | `env-kind-control` | feature | 1, 2 | new component + form |
| 4 | `preset-list-indicator` | feature | 2 | list row |
| 5 | `composer-seed-wiring` | feature | 1 | three creation dialogs |
| 6 | `features-doc-truth` | docs | 3, 4, 5 | `FEATURES.md` + 5 copy sites |
| 7 | `behaviour-tests` | test | 3, 4, 5 | `tests/` |

## Sequence

Two roots run in parallel — scope 1 (pure mapping) and scope 2 (extraction) —
because neither touches the other's files. Everything else waits on them.

```
env-seed-mapper ──┬──> env-kind-control ──┐
                  │                       ├──> features-doc-truth
form-extractions ─┴──> preset-list-indicator│
                          composer-seed-wiring ──┴──> behaviour-tests
```

`composer-seed-wiring` also depends only on scope 1, so it can start as soon as
the mapper lands; `behaviour-tests` is last because it pins the behaviour of
everything above it.

## Scopes

### Task and done criterion per scope

The prose criteria below are the same criteria; this table is the index the
build gate reads, so one row per scope keeps "is every scope covered?" answerable
without reading the whole document.

| Task | Done Criterion | Depends on |
|---|---|---|
| Write the pure kind-to-seed mapper and its declaration | `new-worktree` maps to `host/managed-worktree`; every other value maps to `undefined`; two calls share one frozen reference; typecheck passes with indexed access to the SDK type | — |
| Extract the form body and the preset row | Both extracted functions render identically to the code they replaced, both are under 50 lines, the two `source-debt.json` entries are deleted, and `nothing` is added to `inheritedBaseline` | — |
| Add the on/off worktree field | The control writes `form.environmentKind`, reuses only `ISOLATED_WORKTREE_LABEL`, is disabled for built-ins and while saving, writes its own touch classes and focus ring, and refuses an out-of-enum kind with a reader-facing sentence | scope-1, scope-2 |
| Mark worktree presets in the list | A `worktree` pill renders beside the meta span for a worktree preset and for no other, and never inside the truncating span | scope-2 |
| Seed the composer from the preset, stabilised per open | All three dialogs widen their preset prop, pass `defaultEnvironment` keyed on `open`, and `selectCardEnvironment` is untouched | scope-1 |
| Rewrite the documented behaviour | `FEATURES.md:1012-1013` and `:1206-1207` are replaced, the recorded limitations are named, and no pinned refusal string is broken | scope-3, scope-4, scope-5 |
| Pin behaviour, not literals | Every guarded behaviour has an assertion that fails when the behaviour breaks, the exact-args pin is rewritten rather than extended, and no assertion survives a hand-mutation | scope-3, scope-4, scope-5 |

### Scope detail

[SCOPE-1] Pure preset-kind to composer-seed mapping
[TYPE] feature
[DESCRIPTION] One total function in lib/ mapping a preset's environment_kind to the composer's defaultEnvironment, or undefined when there is nothing to seed. Total by design: an unrecognised stored kind maps to undefined so behaviour matches today rather than throwing.
[TARGET_FILES]
- lib/preset-environment-seed.mjs
- lib/preset-environment-seed.d.mts
[DONE_CRITERION]
- new-worktree maps to {type:'host', workspace:{type:'managed-worktree', baseBranch:{kind:'default'}}}
- project-default maps to undefined (the prop is omitted, never seeded with {type:'project-default'}, which the SDK documents as seeding nothing)
- an unrecognised stored kind maps to undefined, not a throw
- the returned objects are module-level frozen constants, so the value is reference-stable across renders (the re-seed defence)
- the .d.mts uses indexed access to the SDK type, since CreateThreadEnvironmentArgs is declared at app.d.ts:368 and is NOT in the export list at :3026
- npm run typecheck passes; lib/ stays host-neutral per the dependency-cruiser rule

[SCOPE-2] Extract form body and preset row to clear the debt ceilings
[TYPE] refactor
[DESCRIPTION] PresetManagerFormView (73, source-debt.json:19) and PresetManagerList (74, :20) are at their exact ceilings and the gate surfaces a carried oversized function the moment its file is edited. Extract the two inner blocks so later scopes can edit them freely.
[TARGET_FILES]
- components/settings/preset-manager-form.tsx
- components/settings/preset-manager-list.tsx
- components/settings/preset-manager-form-body.tsx
- components/settings/preset-manager-preset-row.tsx
- scripts/source-debt.json
[DONE_CRITERION]
- PresetManagerFormBody and PresetManagerPresetRow exist as named exports and render identically to the code they replace
- the two parent entries in scripts/source-debt.json move to their new sizes, or are DELETED if the remainder fits the 50-line budget
- NOTHING is added to inheritedBaseline: it is a literal expected-output list in tests/debt-baseline.test.mjs:39 compared against gate stdout, not a waiver registry. The extracted functions are under 50 lines, so they print nothing and adding them fails the comparison
- tests/debt-baseline.test.mjs, tests/source-shape.test.mjs and tests/source-budgets.test.mjs pass
- tests/preset-ui.test.mjs's composition pins are re-earned to the extraction, not relaxed

[SCOPE-3] The on/off worktree field in the preset editor
[TYPE] feature
[DESCRIPTION] The control this request was about. An on/off checkbox inside the existing open form body, writing form.environmentKind. NOT a two-option radio: revision 2 of the spec still described one, and an executor reading that table would have rebuilt the unearned promise.
[TARGET_FILES]
- components/settings/preset-environment-kind-field.tsx
- components/settings/preset-manager-form-body.tsx
- components/settings/preset-manager-crud.ts
[DONE_CRITERION]
- the control writes form.environmentKind, which the save path already sends
- it reuses ISOLATED_WORKTREE_LABEL from components/isolated-worktree-check.tsx as the concept's name, and writes its OWN help sentence: ISOLATED_WORKTREE_BENEFIT is false here (no agent or card exists yet) and ISOLATED_WORKTREE_DETAILS[2] would tell the reader to create the preset they are creating
- the off state is silent, so the control claims nothing it cannot keep
- min-h-11 and cursor-pointer are written by hand on the label and input, NOT inherited: the reused symbols are plain strings, and isolated-worktree-check.tsx has no focus-within at all
- disabled={busy} while saving, and disabled entirely when preset.builtIn, with the cascade named in the help text
- an unrecognised stored kind renders unchecked with the help text naming it; the mapper treats it as off
- savePreset validates the kind client-side with a reader-facing refusal naming both options, so a raw schema string never reaches the single message line
- environmentKind is always sent explicitly, so the RPC input's .default() cannot silently downgrade a worktree preset
- no new border, section or design token

[SCOPE-4] Make the kind visible in the preset list
[TYPE] feature
[DESCRIPTION] A worktree preset must be distinguishable from a checkout preset without opening it, and the obvious placement is clipped.
[TARGET_FILES]
- components/settings/preset-manager-preset-row.tsx
[DONE_CRITERION]
- a Pill renders when environmentKind is new-worktree; absence reads as off
- the Pill is a SIBLING of the truncating meta span, never inside it: preset-manager-list.tsx:41 wraps the meta content in min-w-0 flex-1 truncate, and a second line there is ellipsised and never renders
- it reuses the Pill already imported by the list; no new token or surface
- inline on the existing row; no fade hook adopted for the capped scroll box

[SCOPE-5] Seed the composer from the preset, stabilised per dialog mount
[TYPE] feature
[DESCRIPTION] Wire defaultEnvironment through the three creation dialogs, and make the seed reference-stable so a preset saved while a dialog is open cannot overwrite a human pick.
[TARGET_FILES]
- components/creation/create-build-dialog.tsx
- components/creation/create-research-dialog.tsx
- components/creation/create-explore-dialog.tsx
[DONE_CRITERION]
- each dialog's preset prop type carries environmentKind
- each passes defaultEnvironment to experimental_NewThreadComposer, and passes NOTHING when the mapper returns undefined
- the seed is captured once per dialog mount with a seeded-once ref: the host re-seeds every default* prop on value change, including touched ones (app.d.ts:2608-2625), and openPresets (build-panel.tsx:145) opens the manager WITHOUT closing the create dialog
- selectCardEnvironment is not touched and the card-environment.mjs:1-11 invariant survives
- no server, RPC contract or migration change

[SCOPE-6] Make the documented behaviour true again
[TYPE] docs
[DESCRIPTION] No FEATURES.md sentence and no echoed UI string may describe the product as it was before the control existed.
[TARGET_FILES]
- FEATURES.md
- server/github-issue-flow.ts
- server/github-rule-rpcs.ts
- lib/github-automation-gate.mjs
- components/github/github-automation-tab.tsx
[DONE_CRITERION]
- FEATURES.md:1012-1013 ("Stelow never re-picks it") rewritten: Stelow now seeds the picker and the person may still change it
- FEATURES.md:1206-1207 ("environment kind stays a preset field") rewritten to describe the authoring control
- the five echoed "create a New-worktree preset" sites reviewed, and updated only where the affordance framing is genuinely stale; two of their strings are pinned by tests/server-github-issue-flow.test.mjs:108,127, so a pinned refusal that remains TRUE is left alone
- FEATURES.md records: the exploratory-workspace carve-out as a SILENT substitution, not a notice; the per-path environment_label divergence and its trigger; that "New preset" inherits the default's kind (already true, so documentation only); the accepted host re-seed semantics
- the GitHub import default is unchanged and FEATURES.md says so where the reader is

[SCOPE-7] Pin behaviour, not literals
[TYPE] test
[DESCRIPTION] Every guarded behaviour gets a test that fails when the behaviour breaks. Authored by a fresh subagent given the requirements alone, per the circular-validation rule.
[TARGET_FILES]
- tests/component-rule-seams.test.mjs
- tests/preset-ui.test.mjs
- tests/preset-environment-seed.test.mjs
- package.json
[DONE_CRITERION]
- the exact-args pin at tests/component-rule-seams.test.mjs:184-187 is REWRITTEN, not extended: its fixture at :158-161 uses environmentKind "local", which is not in the RPC enum, so today the pin asserts that an out-of-enum kind REACHES the rpc. The fixture moves to a valid kind and the exact-args assertion is preserved
- a SEPARATE refusal case asserts one reader-facing message and that upsertPreset is never called
- permissionMode "ask" at :160 is left alone with a comment saying why: this card validates the kind only
- per preset kind including the omitted case and the unrecognised case, asserted on the pure mapper
- reference stability across re-renders, so the re-seed defence is testable without mounting the host composer
- selectCardEnvironment unchanged; a honoured seeded worktree produces no notice; environmentFallbackNotice still fires on a real substitution
- checkbox interaction states: disabled={busy}, the built-in disabled condition, and a min-h-11 + cursor-pointer count
- NO test for AC 11: "New preset" inheritance already ships via defaultForm(), so it is a documentation criterion
- NO test greps the form for the literal "new-worktree": it would pass on broken logic and break on the vocabulary fix
- any new test file is wired into an npm script in the same change; tests/suite-wiring.test.mjs fails the build on an unwired file

## Dependencies

- scope-1: none (pure lib/ module, no imports from app.tsx, server.ts, server/, components/ or hooks/)
- scope-2: none (pure extraction, no behaviour change)
- scope-3: scope-1, scope-2
- scope-4: scope-2
- scope-5: scope-1
- scope-6: scope-3, scope-4, scope-5
- scope-7: scope-3, scope-4, scope-5

The graph is acyclic. Scopes 1 and 2 are the only parallel pair, and they touch
disjoint files.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A default that does not take effect is worse than no default | The seed only ever names a shape the composer can render, so the picker visibly opens on it — the reader can see it worked and see it didn't |
| The seed is overwritten by a preset saved mid-dialog | Reference-stable frozen constants plus a seeded-once ref, with a test that does not need the host composer |
| An out-of-enum stored kind reaches the server | Client-side validation with a reader-facing refusal; enum and CHECK remain as defence in depth |
| A worker lands in the wrong checkout silently on a personal project | Recorded as a stated limitation in FEATURES.md, and carved out of the DoD word for word rather than implied noticed |
| Circular validation — the agent that wrote the code wrote its own test | Scope 7 is authored by a fresh subagent given the requirements alone |

## Done Criterion

All seven scopes are implemented, `npm run typecheck` and `npm test` are green,
`npm run quality:shape` passes with the two ceilings lowered rather than
raised, `npm run architecture` reports no cycle, and FEATURES.md describes every
changed behaviour. Recorded limitations that are deliberately not fixed — the
per-path environment_label divergence and the silent exploratory substitution —
are named in FEATURES.md rather than left to be discovered.