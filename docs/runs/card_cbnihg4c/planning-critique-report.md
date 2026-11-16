---
spec: .stelow/2026-09-30/sw-card_cbnihg4c/plans/spec-product.md
appetite: Complete
appetite_fit: fits
review_mode: Auto
gap_verdict: "gaps resolved"
verification_verdict: needs-revision
gaps:
  - severity: critical
    tag: feasibility
    title: "DoD 7, AC 9, a Dangers bullet and an OUT/IN row rest on a false premise"
    description: >-
      The spec asserts tests/component-rule-seams.test.mjs and
      tests/card-creator-environment-optional.test.mjs are 'wired into no npm
      script' and makes wiring them IN scope. Both are invoked by
      package.json's test:contracts, which `npm test` chains (test also ends
      with test:source-budgets). tests/suite-wiring.test.mjs additionally fails
      the build when any tests/*.test.mjs is unwired, so the premise cannot hold
      with green CI.
    recommendation: >-
      Delete DoD item 7, AC 9, the Test-shape wiring clause and the OUT/IN row
      'Wiring the two orphaned guard files into an npm script'. Replace with
      extending the already-running exact-args pin at
      tests/component-rule-seams.test.mjs:184-190, which already asserts
      environmentKind in the upsertPreset payload (fixture value 'local', itself
      outside the enum — see the enum-default gap).
    verification: confirmed-by-execution
    resolved: true
  - severity: critical
    tag: feasibility
    title: "The source ceilings make the prescribed implementation fail the debt gate"
    description: >-
      The spec concludes 'it must be a new component' from PresetManagerFormView
      being at exactly 73 lines and PresetManagerList at 74, both at their
      recorded ceilings in scripts/source-debt.json. Verification proved the
      truth is stronger: ANY edit to either file fails
      tests/debt-baseline.test.mjs, because neither function appears in
      inheritedBaseline, so any touch puts it in the changed set and the
      assertion 'the inherited debt set changed; a split or a new violation must
      be recorded here' fires — even for a net-zero edit that only appends a
      word to an existing line. The architectural conclusion is therefore not
      merely insufficient but irrelevant.
    recommendation: >-
      Extract PresetManagerFormBody from components/settings/preset-manager-form.tsx
      and PresetManagerPresetRow from components/settings/preset-manager-list.tsx,
      add both entries to inheritedBaseline in tests/debt-baseline.test.mjs in
      the gate's print order (alphabetically: after plugin-update-status.tsx,
      before preset-onboarding.tsx), and lower both ceilings in
      scripts/source-debt.json — in the same commit, or the gate is red.
    verification: confirmed-by-execution
    resolved: true
  - severity: critical
    tag: flow
    title: "Re-seeding overwrites a human choice, contradicting DoD 4 and AC 2"
    description: >-
      The spec lists host re-seeding as 'accepted host semantics, documented in
      FEATURES.md', but the trigger is reachable in-product, not hypothetical:
      openPresets (components/panels/build-panel.tsx:145) sets presetsOpen
      without closing the create dialog, and both render in the same fragment
      (build-panel-dialogs.tsx:88-102, :112-118). A save fires onChanged ->
      props.state.load() -> loadBuildData replaces data.boardPresets
      (build-panel-state.ts:171) -> analysisPreset returns a new row (:226-232)
      under a live composer. The SDK states the rule: default* props are
      value-compared each render and any change re-seeds EVERY execution and
      environment selection, including ones already touched
      (bb-plugin-sdk-app.d.ts:2608-2625). DoD 4 says 'Picking something else in
      the picker always wins.'
    recommendation: >-
      Promote R2's own suggestion from spike to committed decision: a
      value-stable seed computed once per dialog mount (useMemo keyed on
      environmentKind plus a seeded-once ref, or frozen constants in the lib
      module), plus an AC for the changed-preset-while-open case. Demote AC 7
      to a fallback that applies only if the composer is later observed
      re-seeding on a stable value.
    verification: confirmed
    resolved: true
  - severity: critical
    tag: flow
    title: "DoD 5 and AC 6 contradict each other on exploratory workspaces"
    description: >-
      DoD 5 reads 'No card ever lands in a different checkout than the one its
      dialog showed, with no notice'. AC 6 accepts exactly that case. Verified
      at both ends: server/cards-create.ts:249-252 is
      `workspace.exploratory ? workerEnvironment(..., true) : selectCardEnvironment(...)`,
      so the exploratory branch never consults input.environment, and the notice
      writer bails first at server/cards-create-persist.ts:118
      (`if (workspace.exploratory) return;`). workerEnvironment with
      forceWorkspaceHost returns host + unmanaged, which describeCardEnvironment
      labels 'shared' (lib/tracks.mjs:100-101) — so a worktree preset on a
      personal project lands the card in the shared checkout with no log, no
      comment, no signal. Reachability is narrowed but real: only research and
      explore get there (server/cards-create.ts:131-134 throws for a build card
      on proj_personal).
    recommendation: >-
      Add the exploratory carve-out to DoD 5 word for word, and state in
      FEATURES.md (which DoD 8 already requires) that the substitution is
      silent rather than noticed.
    verification: confirmed
    resolved: true
  - severity: critical
    tag: data
    title: "Editing a built-in preset's kind cascades globally, with no stated bound"
    description: >-
      Edit renders unconditionally for built-ins
      (components/settings/preset-manager-list.tsx:63-70; the !preset.builtIn
      guard at :71 covers Delete only) and the UPDATE branch
      (server/preset-handler-crud.ts:89-96) writes every field of a built-in row;
      only rename, duplicate and replace are refused (:23-30). The cascade is
      two-hop with an OR condition: firstWorktreePreset
      (server/preset-lookups.ts:114-120) returns the flipped built-in, which
      feeds resolveWorktreePreset (github-automation-context.ts:89-92) and
      effectiveBuildEnvironmentKind (:121-131); lib/github-automation-gate.mjs:25-30
      then un-parks every automation rule that was parked for want of a
      worktree preset, globally, for every project. Separately, defaultForm
      (preset-manager-form-state.ts:68-72) spreads the default preset's form and
      clears only id and name, so the flipped kind becomes the inherited kind of
      every preset created afterwards. AC 4 blesses built-in round-tripping
      without noticing any of this.
    recommendation: >-
      Disable the kind control when preset.builtIn, and add an AC plus a
      FEATURES.md paragraph naming the cascade. The question is a product call
      and is flagged for Gate, not auto-resolved.
    verification: confirmed-end-to-end
    resolved: false
  - severity: critical
    tag: data
    title: "environment_label divergence is permanent and per-path, not a one-time flip"
    description: >-
      The Dangers bullet reads 'A seeded card stores worktree where it
      previously stored managed/shared', phrased as a migration. It is not.
      lib/tracks.mjs:94-101 reaches 'worktree' ONLY for host +
      managed-worktree, and tests/tracks.test.mjs:51-54 pins exactly that table.
      A composer-started card (which will now submit host+managed-worktree)
      stores 'worktree'; an auto-started GitHub card, a CLI-drafted card and a
      research-fanout card never set input.environment
      (github-automation-rules.ts:145, cli-split.ts:255,
      research-fanout.ts:102) and take the selectCardEnvironment(undefined, ...)
      branch, storing 'shared' or 'managed'. Same preset, two labels, forever —
      sitting directly under DoD 5.
    recommendation: >-
      Restate the bullet as a per-path divergence, and decide whether
      describeCardEnvironment should prefer the preset's intent over the
      submitted shape. This changes what FEATURES.md:1008-1013 is allowed to
      claim, so it cannot wait for implementation — flagged for Gate.
    verification: confirmed
    resolved: false
  - severity: critical
    tag: design-quality
    title: "The label 'Project checkout' is a promise the shipped code does not keep"
    description: >-
      The spec's table pairs stored 'project-default' with the label 'Project
      checkout' while deliberately omitting the seed prop. The SDK states what
      omission yields (bb-plugin-sdk-app.d.ts:2651-2652): '{ type:
      "project-default" } seeds nothing; the composer resolves its own default
      and submits that concrete environment instead' — so omitting is correct,
      and the resulting label is whatever the composer resolves, mapped by
      lib/tracks.mjs:96-101 to 'managed' or 'shared', never a word the reader
      can tie to 'Project checkout'. AC 3 guarantees only 'byte-for-byte
      today's behaviour', which is not a checkout guarantee. Caveat carried from
      verification: the spec's supporting claim that BB's project-default now
      resolves to a fresh managed worktree cites commit 893a05a, which is not in
      this repository and cannot be verified in-repo; a spec whose central
      vocabulary premise rests on an unpinned external commit should say so.
    recommendation: >-
      Rename the option to what omission actually means (e.g. 'Project default
      (BB chooses)'), or invert the control to a single 'Isolated worktree:
      on/off' toggle whose off state needs no guarantee. Document the
      tracks.mjs label consequence in the same table. Reader-facing naming is a
      product call — flagged for Gate.
    verification: confirmed-conclusion-evidence-base-flagged
    resolved: false
  - severity: important
    tag: state
    title: "No defined state for a stored kind outside the two options"
    description: >-
      The kind arrives as a plain string (preset-manager-types.ts:8; RPC output
      z.string() at platform-rpc-contract.ts:80) and is cast unchecked into the
      union at preset-manager-types.ts:48-49 (which does the same unchecked cast
      for permissionMode at :46-47). Out-of-enum values are reachable on two
      paths: server/preset-migrations.ts:11 gives fresh installs a CHECK, but
      the upgrade path at :53-59 adds the column with no CHECK; and
      server/runtime/cli/cli-draft.ts:100-107 casts --workspace blind and calls
      the handler directly. In that state no radio is checked and saving
      renders a raw schema string into the form's single message line
      (preset-manager-crud.ts:88), which the schema was proven to produce as
      'environmentKind: Invalid option: expected one of "project-default"|"new-worktree"'.
    recommendation: >-
      Make formFromPreset the normalisation point (map anything outside the
      union to project-default), give the field an explicit unrecognised-value
      state so the group is never silently empty, and make the seed mapping
      total so an unknown kind behaves exactly as today.
    verification: confirmed-by-schema-execution
    resolved: true
  - severity: important
    tag: system
    title: "The error surface for an invalid kind is a raw schema string"
    description: >-
      The RPC input is z.enum(['project-default','new-worktree'])
      (platform-rpc-contract.ts:100), so an out-of-enum value is refused at host
      validation before preset-handler-crud.ts:84, and savePreset writes
      error.message verbatim into the single message field
      (preset-manager-crud.ts:88). Without the CHECK on upgraded installs the
      value instead reaches the UPDATE and better-sqlite3 raises a constraint
      error. The one hand-written refusal in the same function is a sentence:
      'Name is required.' (:64-67). Per AGENTS.md state honesty, a refusal names
      a valid redirect; a raw schema dump is not actionable.
    recommendation: >-
      Validate the kind client-side in savePreset before the RPC call with a
      reader-facing refusal naming both options, keeping enum + CHECK as
      defence in depth; add the invalid-kind case to
      tests/component-rule-seams.test.mjs asserting the RPC is never called.
    verification: confirmed
    resolved: true
  - severity: important
    tag: feasibility
    title: "R1's fallback contradicts AC 1 and re-asks a question the SDK already answers"
    description: >-
      AC 1 requires unconditionally that an untouched submit creates a card
      whose stored label is 'worktree'; R1's stated fallback is 'seed nothing and
      say so', which is unachievable for a non-Git source under that AC. R1 also
      re-asks what bb-plugin-sdk-app.d.ts:2645-2647 already documents: 'A host
      environment whose host no longer exists — or whose project has no source
      on it — falls back to the composer's default host'. The spec never says
      that fallback is silent, which is the one fact a reader needs.
    recommendation: >-
      Delete R1's spike, state the documented SDK behaviour and that it is
      silent, make AC 1 conditional on a project with a Git source, and add a
      fourth given under AC 6 for the non-Git case.
    verification: confirmed
    resolved: true
  - severity: important
    tag: feasibility
    title: "R3 is not a genuine unknown — the presets dialog has no project scope"
    description: >-
      R3 asks whether research/explore on a personal project should hide the
      control. components/panels/build-panel.tsx:81 is
      `onOpenPresets={() => props.setPresetsOpen(true)}`, :119 is a bare
      useState, and renderPresetManager is handed to the host at :94 with
      PresetManagerProps exactly {open, onOpenChange, rpc, presets, onChanged} —
      no projectId. The list is fed by rpc.call('listPresets', {}), which is
      board-global. The spec's own SCOPE READING assumption already fixed the
      preset as global. The question is unanswerable as posed.
    recommendation: >-
      Drop R3, or reframe it as the copy question it actually is (what the help
      line says about personal projects) and answer it inside capability 1.
    verification: confirmed (severity raised to high)
    resolved: true
  - severity: important
    tag: affordance
    title: "No reuse candidate named, and the two in-repo radio shapes disagree"
    description: >-
      components/ui/ has no radio or two-option primitive. The two in-repo
      implementations disagree: components/creation/strategy-picker.tsx:68-79
      puts focus-within:outline-primary on the label with an sr-only radio
      (:77) plus a fieldset and sr-only legend (:103-104), while
      components/settings/preset-assign-options.tsx:83-89 uses a visible
      accent-primary radio with no focus-visible/focus-within rule anywhere in
      the file. Only strategy-picker yields WCAG 2.2 focus appearance today. The
      spec argues DRY for placement only, never for visual form.
    recommendation: >-
      Add one sentence naming the copied shape (strategy-picker's focus-visible
      label variant) and why, and state that extraction is out of scope.
      Correction carried from verification: reuse would mean extracting the row,
      not importing it — StrategyPicker:127 and PresetAssignOptions:224 are
      exported, but StrategyOptionRow:64 and PresetOptionRow:64 are not.
    verification: confirmed-with-scope-correction
    resolved: true
  - severity: important
    tag: affordance
    title: "No interaction-state, keyboard, token or disabled specification for the new control"
    description: >-
      The spec's Test shape asserts written and submitted values only. Nothing
      states a semantic element, group/legend, focus order, hover/active states,
      or the disabled condition — even though the form already threads busy
      (preset-manager-form.tsx:10) and disables Save with it (:84-86), which is
      what protects AC 4's untouched round-trip. AGENTS.md requires min-h-11
      touch targets and cursor-pointer on clickables, and says 'a design rule
      with no test is not a rule'; the design-token gate walks
      components/**/*.tsx recursively, so any text-[Npx] in the new file must be
      a named step of lib/design-tokens.ts or a declared TYPE_EXCEPTION.
    recommendation: >-
      Enumerate the applicable states with honest N/A (no async loading, option
      set closed by schema), require disabled={busy} on the new field, name the
      two tokens the group label and help line use, state that the field is form
      content composing with the existing body surface (preset-manager-form.tsx:33)
      rather than a new SECTION_SURFACE, and add a min-h-11 + cursor-pointer
      count pin in the same commit.
    verification: confirmed
    resolved: true
  - severity: important
    tag: design-quality
    title: "The preset-list indicator has no placement, and the obvious one is clipped"
    description: >-
      The spec says only 'The preset list gains one line so the value has a
      visible home'. Read: components/settings/preset-manager-list.tsx:41-46 is
      `<span className='min-w-0 flex-1 truncate'>` wrapping the name plus meta
      line, and truncate is white-space:nowrap — a block child added inside that
      span never renders as a second line. :48-51 are two conditional Pills and
      :52-81 a shrink-0 group of up to three Buttons.
    recommendation: >-
      State the form explicitly: the kind word appended to the existing meta
      line (no growth, no new element), or a Pill rendered only when
      environmentKind === 'new-worktree' with absence meaning checkout. Say
      'clipped', not 'ellipsised' — the ellipsis applies to the container's own
      inline overflow; a nested block child is cut by it. State that the row
      owns this fact.
    verification: confirmed-with-mechanical-correction
    resolved: true
  - severity: important
    tag: design-quality
    title: "The stale-copy claim is unsupported, and the work is wider than the spec names"
    description: >-
      The spec says components/isolated-worktree-check.tsx:13 'tells the reader
      they must go elsewhere for something they can now make here'. Read: the
      line is 'Needs a New-worktree preset in Agent Presets — without one the
      card parks with an explanation instead of starting in your checkout'. It
      names Agent Presets as the place, so it stays TRUE after this change. On
      the FEATURES side, :1206-1207 ('environment kind stays a preset field') is
      an under-description; only :1012-1013 ('environment, branch forwarded
      unchanged; Stelow never re-picks it') genuinely becomes incomplete.
    recommendation: >-
      Drop the 'created elsewhere' framing from DoD item 6 and restate the copy
      work precisely: the echoed sentence also appears at
      server/github-issue-flow.ts:213,232, server/github-rule-rpcs.ts:91,
      lib/github-automation-gate.mjs:34, components/github/github-automation-tab.tsx:76
      (plus shared-checkout.ts:10, lib/shared-checkout-exposure.mjs:10,
      components/detail/file-occupancy.tsx:18 as comments), and
      tests/server-github-issue-flow.test.mjs:107,127 pin two of those strings by
      regex — so editing that copy is a test change, not a one-line edit. At
      least six files plus two test pins, not one.
    verification: confirmed-with-factual-correction-to-spec
    resolved: true
  - severity: important
    tag: flow
    title: "The server-side fallback is not dead code, and the restart paths write no notice"
    description: >-
      The spec's Problem section calls workerEnvironment's result 'dead code on
      the main path' and lists changing server/workers.ts:103 as OUT. workerEnvironment
      (:94-104) is still the sole consumer of preset.environment_kind on every
      path that sends no explicit environment, and those paths are live: the
      respawn fallback at :194-206 (fallbackEnvironment), reached from the
      fresh()/respawn chain at :295-302, covers a card parked in the Bucket and
      started later; a preset swap re-enters it via refreshRestartPending
      (server/preset-handler-assignments.ts:60-77). None of these writes a
      substitution notice — the only notice site is create-time and returns early
      for exploratory workspaces.
    recommendation: >-
      Restate the claim as 'dead on the composer path'. Keep workers.ts unchanged
      if that is the decision, but state the consequence explicitly and give
      those paths an observable trail comment, plus an AC naming the worktree a
      Bucket-started, imported, or CLI-drafted card lands in.
    verification: confirmed
    resolved: true
  - severity: important
    tag: state
    title: "The New preset flow silently inherits the default's kind, with no AC"
    description: >-
      defaultForm clones the whole form from the default preset and clears only
      id and name (preset-manager-form-state.ts:68-72), so once the board default
      is a worktree preset every 'New preset' form opens with Worktree pre-checked
      and saves that way (preset-manager-crud.ts:78). EMPTY_PRESET_FORM
      (preset-manager-types.ts:29) applies only when no presets exist. AC 4
      covers the edit flow only, so the create-flow state is undefined.
    recommendation: >-
      Add an AC for the create flow (inherit or reset, decided explicitly) and
      record the choice next to defaultForm's docstring.
    verification: "confirmed (line correction: EMPTY_PRESET_FORM at :29)"
    resolved: true
  - severity: important
    tag: state
    title: "The card assign dialog keeps hiding the kind where a preset is chosen"
    description: >-
      PresetSummary already carries environmentKind
      (components/settings/preset-assign-options.tsx:11) and each option row's
      subtitle prints provider/model only (:156, :252, :261). That dialog is
      mounted on card detail and is what the CLI refusal copy itself points the
      reader to (cli-draft.ts:55). After this change a worktree preset is still
      indistinguishable at assignment — and assignment feeds the respawn fallback.
    recommendation: >-
      Extend the kind to the assign row's subtitle (one line, no new row), or add
      an explicit OUT entry naming preset-assign-options.tsx with the reason. The
      plan should state one rather than leave the surface silent.
    verification: confirmed
    resolved: true
  - severity: important
    tag: composition
    title: "The deferred effect of the control has no surface of its own"
    description: >-
      The composer names the active preset but not its kind:
      components/creation/create-build-dialog.tsx:119 renders
      `lines={['Analysis phase runs on ${analysisName}']}`, with the research and
      explore twins doing the same at :96 each. The prop types at
      create-build-dialog.tsx:134, create-research-dialog.tsx:110 and
      create-explore-dialog.tsx:110 are all {providerId, modelId,
      reasoningLevel, permissionMode, name} — environmentKind absent from all
      three. A reader meeting a seeded worktree picker has no way to learn a
      preset chose it, and the highest-consequence field in the form (where the
      agent works) is given the same unspecified weight and position as a
      free-text name inside a two-row collapsed body. Decisive supporting fact:
      environmentKind is today carried end-to-end and surfaced in no
      user-facing string anywhere in components/.
    recommendation: >-
      Name the control's position (after Name, before the pickers it conditions)
      and extend the composer's preset line to state the kind, so the seed's
      source is legible where the reader meets it. Note the real path is
      components/creation/, not components/panels/.
    verification: confirmed
    resolved: true
  - severity: important
    tag: feasibility
    title: "The named lib module is not literally writable as the spec describes"
    description: >-
      The spec's signature is presetKind -> CreateThreadEnvironmentArgs |
      undefined in lib/. That type is declared non-exported at
      @get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts:368 and is absent
      from the file's only two export statements, so it cannot be imported by
      name. Every lib/*.mjs ships a hand-written sibling .d.mts (196 of 198 do)
      and tests/declaration-surface.test.mjs polices the pairing. No lib/*.mjs
      currently imports the SDK at all, so this would be the first.
    recommendation: >-
      Name lib/preset-environment-seed.mjs plus its .d.mts and return
      NonNullable<NewThreadComposerProps['defaultEnvironment']> — a type that IS
      exported. lib/card-environment.mjs / .d.mts is the house precedent
      (its params are typed as `unknown` precisely because the SDK types are
      unreachable). Import it as ../../lib/preset-environment-seed.mjs from each
      dialog.
    verification: confirmed-by-sdk-export-surface
    resolved: true
  - severity: minor
    tag: data
    title: "An omitted kind silently downgrades a worktree preset — and dropping the default is a contract change"
    description: >-
      server/platform-rpc-contract.ts:100 defaults an absent environmentKind to
      'project-default', and writePreset persists input.environmentKind with no
      presence check (preset-handler-crud.ts:84), unlike baseBranch/machineId
      which use ?? null (:85-86). Proven by schema execution: omitting the field
      succeeds and parses as project-default; passing an out-of-enum value is
      refused. Any caller that omits it — a stale bundled client, a future CLI or
      automation writer — turns a worktree preset into a checkout preset on its
      next save, with no error and no log. AC 4's guarantee holds today only
      because the one UI caller always sends the field.
    recommendation: >-
      Decide and declare: (a) drop .default(...) so absence is a loud refusal —
      which IS a contract change and contradicts the spec's 'no contract change'
      framing, or (b) keep it and add a tests/server-presets.test.mjs contract
      test asserting a stored new-worktree preset re-saved without the field
      stays new-worktree. Flagged for Gate: the spec cannot claim both.
    verification: confirmed-by-schema-execution
    resolved: false
  - severity: minor
    tag: state
    title: "The list gains height inside a capped scroll box with no scroll affordance"
    description: >-
      The preset list is capped at max-h-56 (224px) with overflow-auto
      (preset-manager-list.tsx:30) and rows are ~38px + 6px gap, so roughly five
      rows are visible today (the critique's '~3' was a slip). The list has no
      bottom fade, while the house pattern for a scrollable option list does
      (preset-assign-options.tsx:173-191 useScrollFade, :204-219 the gradient).
      The plan names no overflow state for the row it adds.
    recommendation: >-
      Adopt the inline meta-line form (no growth) or useScrollFade for this
      list, and state the real visible-row cost of any per-row addition.
    verification: confirmed-with-magnitude-correction
    resolved: true
  - severity: minor
    tag: design-quality
    title: "AC 1 omits a documented limit of the chosen seed shape"
    description: >-
      AC 1 states the picker 'is seeded to an isolated worktree'
      unconditionally, but the chosen shape
      {type:'host', workspace:{type:'managed-worktree', baseBranch:{kind:'default'}}}
      carries a documented limit (bb-plugin-sdk-app.d.ts:2662-2665): it leaves
      the branch picker on its default, which may resolve to a named base branch
      when the project configures a dedicated worktree base. The Dangers list
      records re-seed, exploratory swallow, environment_label flip and copy, but
      not this.
    recommendation: >-
      Add it beside the environment_label bullet and make AC 1 conditional on
      the source being Git.
    verification: confirmed
    resolved: true
strengths:
  - "The vocabulary finding is the strongest part of the spec and is fully sourced: the stored value stays put, the client states the worktree explicitly instead of delegating to a host value the plugin has already been burned by, and the SDK quote justifying omission for the checkout case is verbatim."
  - "The seed-vs-dead-fallback claim is verifiable in the repository rather than assumed, and it makes the client-side seed the correct minimal intervention while leaving selectCardEnvironment's precedence untouched — the right side of the boundary to intervene on."
  - "Control placement is argued semantically (authoring a shared row vs assigning one) rather than aesthetically, and correctly keeps a card dialog from mutating a globally shared preset."
  - "The option set is provably closed by the migration CHECK, the RPC enum and the form union, so the two-option control needs no empty or unknown state on the normal path."
  - "Non-happy states are enumerated before the happy one, and the Test shape pins written and submitted values rather than literals — with an explicit fresh-subagent authorship rule against circular validation."
verdict: "has gaps"
---

# Product Critique — Preset environment kind (consolidated)

**Spec:** `.stelow/2026-09-30/sw-card_cbnihg4c/plans/spec-product.md`
**Appetite:** Complete · **appetite_fit:** fits · **Review mode:** Auto
**Method:** 5 parallel reviewers (flows+states, data+system, affordances+UX, composition, feasibility), then an independent verification pass that re-checked all 25 findings against the repository — two of them by *execution* rather than reading.

**Verification outcome:** 25 findings checked, none fabricated. 22 confirmed with no material correction, 3 confirmed with line-reference or magnitude slips, 1 confirmed on its conclusion while its external-SHA evidence base is flagged as unverifiable in-repo. Verdict stands: **needs-revision**. The two most consequential findings were proven by running code, and the second turned out *stronger* than the report stated.

## 1. 🎯 Executive Summary

**Flow coverage:** 5/6 — the primary and override flows are precise; the re-seed trigger and the non-dialog start paths are named but not decided.
**State coverage:** 5/7 — the normal path is well covered; unknown stored values, new-preset inheritance and the busy state are undefined.
**Affordance coverage:** 3/9 — a new interactive component with no state, keyboard, token or reuse specification.
**Data coverage:** 4/6 — boundary validation is unstated and two false claims sit under the test strategy.
**System coverage:** 5/6 — the client-side seed is correct; the error surface and the restart-path notice are missing.
**Compositional coverage:** 4/5 — coherent as one job, but the deferred effect has no surface and a phantom scope is bolted on.
**Scope fit:** fits. No cuts required; the defects are correctness and claim-honesty defects, not appetite defects.

**Overall verdict:** has gaps. The architecture is right and the vocabulary finding is excellent, but **seven critical gaps block implementation — three of them because the spec asserts something the repository contradicts, and one of those three makes the prescribed implementation fail a green gate.**

## 2. 🚨 Critical Gaps (Blocking)

- **[feasibility] DoD 7, AC 9, a Dangers bullet and an OUT/IN row rest on a false premise** `(critical)`
  - **What:** Both "orphaned" guard files are invoked by `test:contracts`, which `npm test` chains, and `suite-wiring.test.mjs` fails the build when any test file is unwired. Verified by grep *and* by running both files: `component-rule-seams` prints `# pass 1 # fail 0`, `card-creator-environment-optional` prints ok.
  - **Flagged by:** flows+states, data+system, feasibility — independently, three times. Re-confirmed by execution.
  - **Recommendation:** Delete the four items; replace with extending the existing exact-args pin, which already carries `environmentKind`.
  - **Resolved:** Yes — by default (auto-resolve rule 1: correct a claim the repository contradicts)

- **[feasibility] The source ceilings make the prescribed implementation fail the debt gate** `(critical)`
  - **What:** Stronger than first reported. *Any* edit to either file fails `debt-baseline.test.mjs` — even a net-zero line insertion — because neither function is in `inheritedBaseline` and the gate compares the inherited set verbatim. The spec's "therefore it must be a new component" conclusion is not insufficient but irrelevant.
  - **Flagged by:** feasibility. Proven by two experiments (A: 2-line growth; B: net-zero edit), both files restored.
  - **Recommendation:** Extract `PresetManagerFormBody` and `PresetManagerPresetRow`, add both baseline entries in the gate's print order, lower both ceilings in `source-debt.json` — same commit or the gate is red.
  - **Resolved:** Yes — by default

- **[flow] Re-seeding overwrites a human choice, contradicting DoD 4 and AC 2** `(critical)`
  - **What:** The create dialog opens the preset manager without closing itself; a save refreshes `boardPresets` under a live composer, and the host re-seeds *every* selection including touched ones. Reachable in one click-path, not hypothetical.
  - **Flagged by:** flows+states, data+system, feasibility.
  - **Recommendation:** Commit to a value-stable seed computed once per dialog mount (R2's own suggestion, promoted from spike); demote AC 7 to a fallback.
  - **Resolved:** Yes — by default

- **[flow] DoD 5 and AC 6 contradict each other on exploratory workspaces** `(critical)`
  - **What:** The exploratory branch discards the requested environment before any notice can be computed, and the notice writer returns early. A worktree preset on a personal project lands the card in the shared checkout with no log, comment, or signal.
  - **Flagged by:** flows+states, feasibility.
  - **Recommendation:** Carve the case out of DoD 5 word for word; state in FEATURES.md that the substitution is silent.
  - **Resolved:** Yes — by default

- **[data] Editing a built-in preset's kind cascades globally, with no stated bound** `(critical)`
  - **What:** A two-hop, OR-conditioned cascade: becomes `firstWorktreePreset`, un-parks every automation rule that was parked for want of a worktree preset, and becomes the inherited kind of every preset created afterwards. No confirmation, no project scoping, no band guard.
  - **Flagged by:** data+system.
  - **Recommendation:** Disable the control for built-ins, or add an AC plus a FEATURES.md paragraph naming the cascade.
  - **Resolved:** **No** — product call, flagged for Gate (Q3)

- **[data] `environment_label` divergence is permanent and per-path, not a one-time flip** `(critical)`
  - **What:** The same preset stores `worktree` on the composer path and `shared`/`managed` on every auto-start, CLI, research-fanout, Bucket-respawn and preset-swap path, forever — and the divergence sits directly under DoD 5.
  - **Flagged by:** data+system.
  - **Recommendation:** Restate the bullet as a per-path divergence; decide whether the label should prefer the preset's intent. This bounds what FEATURES.md:1008-1013 may claim, so it cannot wait for implementation.
  - **Resolved:** **No** — product call, flagged for Gate (Q2)

- **[design-quality] The label "Project checkout" is a promise the shipped code does not keep** `(critical)`
  - **What:** The prop is deliberately omitted for that option, so the composer resolves its own default and the card is stored as `managed`/`shared` — a different word from the one the reader was shown. AC 3 guarantees only "byte-for-byte today's behaviour", which is not a checkout guarantee. Separately: the spec's central vocabulary claim rests on bb commit `893a05a`, which is not in this repository and cannot be verified in-repo.
  - **Flagged by:** affordances+UX.
  - **Recommendation:** Rename the option to what omission means, or invert to an on/off toggle whose off state needs no guarantee; and mark the external commit as unpinned.
  - **Resolved:** **No** — reader-facing naming is a product call, flagged for Gate (Q6)

## 3. 🤔 Important Gaps (Refinement)

- **[state]** No defined state for a stored kind outside the two options; upgraded installs have no CHECK and the cast is unchecked (`permissionMode` has the same unchecked cast at :46-47). **Recommendation:** normalise in `formFromPreset`, give the field an explicit unrecognised state, make the seed mapping total. *Resolved: yes by default*
- **[system]** The error surface for an invalid kind is a raw schema string in a sentence slot. **Recommendation:** validate client-side with a reader-facing refusal naming both options; keep enum + CHECK as defence in depth. *Resolved: yes by default*
- **[feasibility]** R1's fallback contradicts AC 1 and re-asks a behaviour the SDK already documents (and documents as silent). **Recommendation:** delete the spike, make AC 1 conditional on a Git source. *Resolved: yes by default*
- **[feasibility]** R3 is not an unknown — `PresetManagerProps` has no `projectId`, and the list is board-global. **Recommendation:** drop it or reframe as the help-line copy question. *Resolved: yes by default*
- **[affordance]** No reuse candidate named; the two in-repo radio shapes disagree and only `strategy-picker` yields WCAG 2.2 focus appearance today. **Recommendation:** name the copied shape; state that extraction (not import) is out of scope. *Resolved: yes by default*
- **[affordance]** No interaction-state, keyboard, disabled, or token specification, though the form already threads `busy` and the design-token gate walks `components/**` recursively. **Recommendation:** enumerate states with honest N/A, require `disabled={busy}`, name the tokens, state the field composes with the existing body surface. *Resolved: yes by default*
- **[design-quality]** The list indicator has no placement and the obvious one is **clipped** by `truncate` (not ellipsised). **Recommendation:** append to the existing meta line, or a Pill only for `new-worktree`. *Resolved: yes by default*
- **[design-quality]** The stale-copy claim is false as written — the line names Agent Presets, so it stays true — and the real work is ≥6 files plus 2 regex-pinned test strings. **Recommendation:** drop the "created elsewhere" framing; restate as precise edits. *Resolved: yes by default*
- **[flow]** `workerEnvironment` is "dead on the composer path", not dead; the respawn fallback and preset-swap paths write no notice. **Recommendation:** restate the claim, add a trail comment and an AC. *Resolved: yes by default*
- **[state]** The New preset flow silently inherits the default's kind; AC 4 covers edit only. **Recommendation:** add the create-flow AC. *Resolved: yes by default*
- **[state]** The assign dialog keeps hiding the kind where a preset is chosen — and assignment feeds the respawn fallback. **Recommendation:** extend the subtitle or add an explicit OUT entry. *Resolved: yes by default*
- **[composition]** The deferred effect has no surface: the composer names the preset but not its kind, and the highest-consequence field sits beside a name field with no stated order. **Recommendation:** state the position; extend the preset line. *Resolved: yes by default*
- **[feasibility]** `CreateThreadEnvironmentArgs` is not exported by the SDK, so the prescribed signature is unwritable; a `.d.mts` sibling is required and policed. **Recommendation:** name the module, use indexed access, follow `lib/card-environment.mjs`. *Resolved: yes by default*

## 4. 🔎 Minor Clarifications

- **[data]** An omitted kind silently downgrades a worktree preset through the input default. **Recommendation:** decide between dropping the default (which *is* a contract change and contradicts the spec's framing) and adding a contract test; declare which. *Resolved: no — flagged for Gate (Q1)*
- **[state]** The list grows inside a `max-h-56` box with no fade; ~5 rows are visible today, not ~3. **Recommendation:** adopt the inline form or `useScrollFade`; state the real visible-row cost. *Resolved: yes by default*
- **[design-quality]** AC 1 omits the documented `baseBranch: {kind:'default'}` limit. **Recommendation:** add it beside the label bullet; make AC 1 conditional on Git. *Resolved: yes by default*

## 5. ✅ Strengths

- The vocabulary finding is the strongest part of the spec and is fully sourced — the stored value stays, the worktree is *stated* rather than delegated to a host value the plugin has already been burned by, and the SDK quote justifying omission is verbatim.
- The seed-vs-dead-fallback claim is verifiable in the repository rather than assumed, and it puts the intervention on the client while leaving `selectCardEnvironment`'s precedence untouched — the right side of the boundary.
- Control placement is argued semantically (authoring vs assigning), not by taste, and correctly keeps a card dialog from mutating a globally shared preset row.
- The option set is provably closed by the migration CHECK, the RPC enum and the form union, so the two-option control needs no empty or unknown state on the normal path.
- Non-happy states are enumerated *before* the happy one, and the Test shape pins written and submitted values rather than literals, with an explicit fresh-subagent authorship rule against circular validation.

## 6. Verification pass (what changed after checking)

The verification pass did not overturn the report. It sharpened it:

- **Strengthened:** the debt-gate finding. The critique said the extraction is *required*; execution showed *any* edit to either file fails, which makes extraction the only path that leaves the gate green — not one option among several.
- **Corrected (in the spec's disfavour):** the list row shows ~5 rows, not ~3; a nested block child is *clipped*, not ellipsised; `EMPTY_PRESET_FORM` is at `:29`; the assign subtitles are at `:156/:252/:261`; `create-build-dialog` lives under `components/creation/`, not `components/panels/`; `renderPresetManager` is at `:94`; reuse of a radio would mean extracting a row, not importing an export.
- **Corrected (in the spec's favour):** `isolated-worktree-check.tsx:13` stays true after this change, so DoD 6's "created elsewhere" framing must go; only `FEATURES.md:1012-1013` genuinely becomes incomplete.
- **Flagged as unverifiable in-repo:** the spec's load-bearing vocabulary claim cites bb commit `893a05a`, absent from this repository. The conclusion (label mismatch) holds regardless of which resolution bb chose, but the spec should not present an unpinned external commit as settled.
- **Presentation note:** the upstream report packs 6–8 `file:line` citations plus a recommendation into single fields, which makes each finding expensive to check, and it interleaves severities in its priority ordering. Neither affects the verdict.

**Prerequisite ordering.** Findings 1, 2 and the enum-default gap are not peers of the medium findings — they are prerequisites. Delete the false DoD/AC, extract the two components and amend the ledger, decide the enum default: until those land, the medium findings describe work that cannot start. The report offers no ordering of its own; this is it.

## 7. 🟢 Resolved Gaps (Product Critique)

Review mode is `Auto`, so per `references/auto-resolve-rules.md` every gap above is an internal recommendation and **no question is pushed to the user at this gate**.

**Accounting.** The upstream critique returned 25 findings; they consolidate to the 23 gaps above. Two were merged rather than dropped: *R2 documents a DoD violation* is the same defect as the re-seeding critical gap seen from its acceptance-criteria side, and *no token or scope statement* is a sub-case of the missing interaction-state specification. 19 of 23 are resolved by default; **4 are recorded as needing a product decision** and are listed for Gate review rather than answered here:

| # | Decision needed | AI recommendation | Why it cannot be auto-resolved |
|---|-----------------|-------------------|----------------------------------|
| Q1 | Enum default: drop `.default(...)` or keep it and pin it? | Keep it, add a contract test in `tests/server-presets.test.mjs` | Dropping the default *is* a contract change; the spec explicitly claims it makes none. Both cannot stand. |
| Q2 | Is the per-path label divergence acceptable? | Accept it, restate DoD 5 as a per-path guarantee | It bounds what `FEATURES.md:1008-1013` may claim — a product statement, not an implementation detail. |
| Q3 | Should the kind control be disabled for built-ins? | Disable for `preset.builtIn` | The alternative (allow with a warning) is defensible; the cascade is a policy call. |
| Q4 | List indicator form: meta-line word or conditional Pill? | Meta-line word (no growth) | Both are acceptable; the row-height cost is a design trade-off. |
| Q5 | Seed stability: commit to the memoized seed? | Yes — promote R2's suggestion to a decision | Defaulted in §2 as a default; listed so the human can see it was a call, not a derivation. |
| Q6 | Radio visual form: copy `strategy-picker`? | Yes, and extract nothing this cycle | Reader-facing focus treatment is a design call. |
| Q7 | Name for the non-seeded option: rename, or invert to an on/off toggle? | Invert to "Isolated worktree: on/off" | The off state then needs no guarantee, which dissolves the promise the current label cannot keep. |

Q4, Q5 and Q6 are auto-resolved above and listed only for visibility. **Q1, Q2, Q3 and Q7 are genuinely open** — the four worth a human glance during Gate review. Note the ordering constraint: Q1 changes the RPC contract, so it must be decided before the enum-default gap can be closed by a test; and Q2 bounds what `FEATURES.md:1008-1013` may claim, so it must be decided before that prose is written, not after.
