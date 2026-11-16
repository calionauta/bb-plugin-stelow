---
gaps:
  - severity: critical
    tag: feasibility
    title: "Three Definition-of-Done items and one acceptance criterion rest on a false premise"
    description: "The Dangers bullet, DoD item 7, Acceptance Criterion 9 and the OUT/IN table row all assert that tests/component-rule-seams.test.mjs and tests/card-creator-environment-optional.test.mjs are 'wired into no npm script'. Both are invoked by package.json's test:contracts script, and npm test chains test:contracts. tests/suite-wiring.test.mjs fails the build when any tests/*.test.mjs is unwired, so the premise cannot be true with green CI."
    recommendation: "Delete DoD item 7, AC 9, the Test-shape wiring clause and the OUT/IN row. Replace them with the real work: extend the already-running exact-args pin in component-rule-seams.test.mjs, which already asserts environmentKind in the upsertPreset payload."
    resolved: false
  - severity: critical
    tag: feasibility
    title: "The stated source ceilings make the prescribed implementation fail the debt gate"
    description: "PresetManagerFormView is at 73 lines against a 73 ceiling and PresetManagerList at 74 against 74. The plan concludes 'therefore it must be a new component', but rendering a new component from the form body still costs an import line plus one JSX line, and the list's indicator costs at least one line. Both files are absent from inheritedBaseline, so editing either puts its oversized function into the changed set and debt-baseline fails until ledger lines are added in the gate's print order."
    recommendation: "Extract PresetManagerFormBody from preset-manager-form.tsx and PresetManagerPresetRow from preset-manager-list.tsx, add the two inheritedBaseline entries in print order, and lower both ceilings in scripts/source-debt.json in the same commit."
    resolved: false
  - severity: critical
    tag: flow
    title: "Re-seeding overwrites a human choice, contradicting DoD 4 and AC 2"
    description: "The plan lists host re-seeding as accepted host semantics, but the trigger is reachable in-product: the create dialog opens the preset manager without closing itself, a save refreshes boardPresets, and the active preset's kind changes under a live composer, which re-seeds every environment selection including touched ones. DoD 4 says 'Picking something else in the picker always wins'."
    recommendation: "Decide rather than document: compute the seed once per dialog mount (useMemo keyed on environmentKind, plus a seeded-once ref) or close the create dialog when the preset manager opens. Then add an AC for the changed-preset-while-open case."
    resolved: false
  - severity: critical
    tag: flow
    title: "DoD 5 and AC 6 contradict each other on personal projects"
    description: "The exploratory branch is taken before the requested environment is consulted and the notice writer returns early for exploratory workspaces, so a card lands in a different checkout with no notice at all. DoD 5 states no card ever lands in a different checkout with no notice; AC 6 accepts exactly that case."
    recommendation: "Add the exploratory carve-out to DoD 5 word for word, and state in FEATURES.md that the substitution is silent rather than noticed."
    resolved: false
  - severity: critical
    tag: design-quality
    title: "The label 'Project checkout' is a promise the shipped code does not keep"
    description: "The seed for that option is deliberately omitted, so the composer resolves its own default, which BB may turn into a managed worktree, and the stored environment label for such a card is managed rather than shared. The reader sees 'Project checkout' on the preset and a different word on the card."
    recommendation: "Either rename the option to what omitting the seed means, or invert the control to a single 'Isolated worktree: on/off' toggle whose off state needs no guarantee. Document the label consequence in the same table."
    resolved: false
  - severity: critical
    tag: data
    title: "Making the built-in default preset's kind editable cascades with no stated bound"
    description: "The Edit control renders for built-ins, the update branch writes every field of a built-in row, and only rename, duplicate and delete are refused. Flipping the built-in default to worktree therefore re-routes every auto-started GitHub worker through firstWorktreePreset, un-parks the automation gate, and becomes the inherited kind of every preset created afterwards via defaultForm. AC 4 blesses built-in round-tripping without noticing any of this."
    recommendation: "Either disable the kind control when preset.builtIn, or add an AC and a FEATURES.md paragraph naming the cascade."
    resolved: false
  - severity: critical
    tag: data
    title: "The environment_label change is a permanent per-path divergence, not a one-time flip"
    description: "Auto-start and CLI creators never set an environment, so they take the server fallback and store the managed label, while composer-started cards store worktree. The same preset yields two different stored labels forever. The Dangers bullet frames this as a migration."
    recommendation: "Restate the bullet as a per-path divergence and decide whether describeCardEnvironment should prefer the preset's intended kind over the submitted shape."
    resolved: false
  - severity: important
    tag: state
    title: "No defined state for a stored kind outside the two options"
    description: "The listed kind arrives as a plain string and formFromPreset casts it unchecked into the union. Upgraded installs add the column by ALTER TABLE with no CHECK, and the CLI casts blindly. In that state no radio is checked and saving renders a raw schema message into the single message line."
    recommendation: "Make formFromPreset the normalisation point, give the field an explicit unrecognised-value state, and make the seed mapping total so an unknown kind behaves as today."
    resolved: false
  - severity: important
    tag: system
    title: "The error surface for an invalid kind is a raw schema string"
    description: "The RPC input is an enum, so an out-of-enum value is refused at host validation and the raw message is written verbatim into the form's message field. Without the CHECK on upgraded installs the value instead reaches the UPDATE and better-sqlite3 raises a constraint error. The one hand-written refusal nearby is a sentence."
    recommendation: "Validate the kind client-side in savePreset with a reader-facing refusal naming both options, keeping the enum and CHECK as defence in depth."
    resolved: false
  - severity: important
    tag: feasibility
    title: "R1's fallback contradicts AC 1 and re-asks a question the SDK already answers"
    description: "AC 1 requires unconditionally that an untouched submit stores the worktree label, but R1's default is to seed nothing for non-Git sources, which makes AC 1 unachievable there. The SDK already documents the fallback for a host with no project source."
    recommendation: "Delete R1's spike, state the documented SDK behaviour, make AC 1 conditional on a project with a Git source, and note that the fallback is silent."
    resolved: false
  - severity: important
    tag: feasibility
    title: "R2's fallback documents a behaviour two DoD items deny"
    description: "R2's default is to document host semantics, which does not satisfy AC 7 but does contradict DoD 4 and AC 2."
    recommendation: "Promote R2's own memoization suggestion into a committed mitigation, and only keep the documentation fallback if the composer is later observed re-seeding on a stable value."
    resolved: false
  - severity: important
    tag: feasibility
    title: "R3 is not an unknown: the presets dialog has no project context to hide a control against"
    description: "The manager is opened with no project scope, and build cards on personal projects already throw, so only research and explore can reach the case AC 6 already states."
    recommendation: "Drop R3, or reframe it as the help-line copy question and answer it inside capability 1."
    resolved: false
  - severity: important
    tag: affordance
    title: "No reuse candidate named, and the two in-repo radio shapes disagree"
    description: "There is no shared primitive; the two existing implementations are private and differ on focus treatment, one having no focus-visible rule at all. The plan argues DRY for placement but never for the control's visual form, and the repo's own threshold is third repetition, so this is the second radio group, deliberately local."
    recommendation: "Name the shape being copied and why, and note that reuse would mean extracting a non-exported component, which is out of scope."
    resolved: false
  - severity: important
    tag: affordance
    title: "No interaction-state, keyboard or disabled specification for the new control"
    description: "The plan pins payloads only. It states no semantic element, group or legend, focus order, hover and active states, or disabled condition, even though the form already threads busy and the Save button is disabled by it, which is what protects AC 4's untouched round-trip."
    recommendation: "Enumerate the applicable states with honest N/A, require a min-h-11 plus cursor-pointer count pin and disabled-while-busy in the same commit."
    resolved: false
  - severity: important
    tag: design-quality
    title: "The preset-list indicator has no placement, and the obvious one is clipped"
    description: "The row's meta span is truncate, so a second line added inside it is ellipsised and never renders, and the row's right edge is already occupied by two pills and three action buttons. The plan says only that the list 'gains one line'."
    recommendation: "Specify either appending the kind word to the existing meta line with truncate moved onto the meta span, or a Pill rendered only for worktree presets, and state the fact's single home."
    resolved: false
  - severity: important
    tag: design-quality
    title: "The stale-copy claim is not supported by the cited lines"
    description: "The import-dialog line names Agent Presets as the place to set it, not elsewhere, and stays true after this change. FEATURES.md's 'environment kind stays a preset field' is an under-description, not a falsehood. Only the line about the environment being forwarded unchanged genuinely becomes incomplete."
    recommendation: "Restate the copy work as three precise edits and drop the 'created elsewhere' framing from the DoD."
    resolved: false
  - severity: important
    tag: flow
    title: "The server-side fallback is described as dead code, and the respawn paths have no notice at all"
    description: "The fallback is still the sole consumer of the preset kind on GitHub import, CLI-drafted cards, and every restart or respawn of a card with no live worker, including a card parked in the Bucket and started later. None of those paths write a substitution notice, so flipping a preset to worktree moves cards on them silently."
    recommendation: "Keep workers.ts unchanged if that is the decision, but state the consequence and give those paths an observable trail comment."
    resolved: false
  - severity: important
    tag: state
    title: "The New preset flow silently inherits the board default's kind, with no acceptance criterion"
    description: "defaultForm copies every field of the default preset and clears only id and name, so once the default is a worktree preset every new preset opens with Worktree pre-checked and saves that way. AC 4 covers the edit flow only."
    recommendation: "Add an AC for the create flow and record the inherit-or-reset decision next to defaultForm."
    resolved: false
  - severity: important
    tag: state
    title: "The card assign dialog keeps hiding the kind where a preset is chosen"
    description: "PresetSummary already carries environmentKind and the row subtitle prints provider and model only. After this change a worktree preset is still indistinguishable at assignment, and assignment feeds the respawn fallback."
    recommendation: "Extend the visible-kind work to the assign dialog subtitle, or add an explicit OUT entry naming the file with the reason."
    resolved: false
  - severity: important
    tag: composition
    title: "The deferred effect of the control has no surface of its own"
    description: "The composer names the active preset but not its kind, so a reader meeting a seeded worktree picker has no way to learn that a preset chose it or how to change that. The highest-consequence field is also added to a two-row collapsed body at the same weight as a free-text name, with no order stated."
    recommendation: "Name the control's position in the body, and extend the composer's preset line to state the kind, so the seed's source is legible where the reader meets it."
    resolved: false
  - severity: important
    tag: feasibility
    title: "The named lib module is not literally writable as described"
    description: "The environment args type is not exported by the SDK, so it cannot be imported by name, and every lib module ships a hand-written sibling declaration file that a declaration-surface test polices. The plan names neither the file nor the declaration."
    recommendation: "Name the module and its declaration, and return the composer's prop type by indexed access instead of the SDK's unexported name."
    resolved: false
  - severity: minor
    tag: data
    title: "An omitted kind silently downgrades a worktree preset"
    description: "The RPC input defaults an absent kind to project-default and the write persists it with no presence check, unlike the nullable siblings. Any caller that omits the field turns a worktree preset into a checkout preset on its next save, and AC 4's guarantee is held only by the one caller that always sends it."
    recommendation: "Either drop the default so absence is a loud refusal, or add a contract test that a stored worktree preset re-saved without the field keeps its value."
    resolved: false
  - severity: minor
    tag: state
    title: "The list gains a row inside a fixed-height scroll box with no scroll affordance"
    description: "The list is capped and scrollable, shows about three rows today, and has no bottom fade, while the house pattern for a scrollable option list does. The plan names no overflow state for the row it adds."
    recommendation: "Render the kind inline rather than as a second line, or adopt the existing scroll-fade hook, and state the visible-row cost."
    resolved: false
  - severity: minor
    tag: design-quality
    title: "AC 1 omits a documented limit of the chosen seed shape"
    description: "A managed-worktree seed with the default base branch leaves the branch picker on its default, which may resolve to a named base branch when the project configures a dedicated worktree base. This limit is absent from the Dangers list."
    recommendation: "Add it beside the environment_label bullet and make AC 1 conditional on the source being Git."
    resolved: false
  - severity: minor
    tag: design-quality
    title: "No token or scope statement for the new file"
    description: "The design-token gate walks all component files recursively, so the new file's type sizes must come from the named scale or a declared exception, and the plan says nothing about whether the field is form content or a new section surface."
    recommendation: "Name the two tokens the group label and help line use, and state that the field composes with the existing body surface without adding a border treatment."
    resolved: false
strengths:
  - "The vocabulary finding is the strongest part of the plan and is fully sourced: the stored value stays put, the client states the worktree explicitly instead of delegating to a host value the plugin has already been burned by, and the SDK quote justifying omitting the prop for the checkout case is verbatim."
  - "The dead-fallback claim is verifiable in the repo rather than assumed, and it makes the seed the correct minimal place to intervene while leaving the precedence function untouched."
  - "Placement is reasoned semantically, not aesthetically: the manager form authors a shared row while the assign dialog chooses one, so the control stays out of the shared picker."
  - "The option set is provably closed by the schema, the RPC enum and the form union, so the two-option control needs no empty or unknown state for the normal path."
  - "Non-happy states are enumerated before the happy one, and the test shape pins written and submitted values rather than literals, with a fresh-subagent authorship rule."
verdict: "has gaps"
---

# Product Critique — Preset environment kind (spec-product.md)

**Spec:** `.stelow/2026-09-30/sw-card_cbnihg4c/plans/spec-product.md`
**Appetite:** Complete · **appetite_fit:** fits · **Review mode:** Auto
**Method:** 5 parallel reviewers (flows+states, data+system, affordances+UX, composition, feasibility) plus independent repository verification of every load-bearing claim.

## 1. 🎯 Executive Summary

**Flow coverage:** 5/6 — the primary and override flows are precise; the re-seed and non-dialog start paths are named but not decided.
**State coverage:** 5/7 — the normal path is well covered; unknown stored values, the new-preset inheritance and the busy state are undefined.
**Affordance coverage:** 3/9 — a new interactive component is introduced with no state, keyboard, token or reuse specification.
**Data coverage:** 4/6 — validation at the boundary is unstated and two false claims sit under the test strategy.
**System coverage:** 5/6 — the client-side seed is correct; the error surface and the restart-path notice are missing.
**Compositional coverage:** 4/5 — coherent as one job, but the deferred effect has no surface and a phantom scope is bolted on.
**Composition/scope:** coherent; one field becomes authorable and then becomes a default.
**Overall verdict:** has gaps. The architecture is right and the vocabulary finding is excellent, but seven critical gaps must be resolved before implementation — three of them because the plan states something the repository contradicts.

## 2. 🚨 Critical Gaps (Blocking)

- **[feasibility] Three Definition-of-Done items and one acceptance criterion rest on a false premise** `(critical)`
  - **What:** Both "orphaned" guard files are invoked by `test:contracts`, which `npm test` chains, and a wiring test fails the build when any test file is unwired. DoD 7 and AC 9 assert work that is already done, and the risk narrative built on it is wrong.
  - **Flagged by:** flows+states, data+system, feasibility — independently, three times.
  - **Recommendation:** Delete the four items; replace them with extending the existing exact-args pin, which already carries `environmentKind`.
  - **Resolved:** No

- **[feasibility] The stated source ceilings make the prescribed implementation fail the debt gate** `(critical)`
  - **What:** Both host functions sit exactly at their ceilings, and neither file is in the inherited baseline, so touching either makes the gate compare against itself.
  - **Flagged by:** feasibility.
  - **Recommendation:** Extract the form body and the list row, add the two baseline entries in print order, and lower both ceilings in the same commit.
  - **Resolved:** No

- **[flow] Re-seeding overwrites a human choice, contradicting DoD 4 and AC 2** `(critical)`
  - **What:** The create dialog opens the preset manager without closing itself; a save refreshes the presets under a live composer, and the host re-seeds every selection, including touched ones.
  - **Flagged by:** flows+states, data+system, feasibility.
  - **Recommendation:** Compute the seed once per dialog mount, or close the create dialog when the manager opens; then add the AC.
  - **Resolved:** No

- **[flow] DoD 5 and AC 6 contradict each other on personal projects** `(critical)`
  - **What:** The exploratory branch discards the requested environment before any notice can be computed, and the notice writer returns early for exploratory workspaces.
  - **Flagged by:** flows+states, feasibility.
  - **Recommendation:** Carve the case out of DoD 5 word for word and state in FEATURES.md that the substitution is silent.
  - **Resolved:** No

- **[design-quality] The label "Project checkout" is a promise the shipped code does not keep** `(critical)`
  - **What:** The seed is omitted for that option, so the composer's own default applies, which BB may resolve to a managed worktree, and the stored label for such a card is not shared-checkout.
  - **Flagged by:** affordances+UX.
  - **Recommendation:** Rename the option to what omission means, or invert it to a single on/off toggle whose off state needs no guarantee.
  - **Resolved:** No

- **[data] Making the built-in default's kind editable cascades with no stated bound** `(critical)`
  - **What:** Editing a built-in writes every field; flipping the default re-routes every auto-started worker, un-parks the automation gate, and becomes the inherited kind of every later preset.
  - **Flagged by:** data+system.
  - **Recommendation:** Disable the control for built-ins, or add an AC and a FEATURES.md paragraph naming the cascade.
  - **Resolved:** No

- **[data] The environment_label change is a permanent per-path divergence, not a one-time flip** `(critical)`
  - **What:** Paths that never set an environment store one label; composer-started cards store another, for the same preset, forever.
  - **Flagged by:** data+system.
  - **Recommendation:** Restate the bullet as a per-path divergence and decide whether the label should prefer the preset's intent.
  - **Resolved:** No

## 3. 🤔 Important Gaps (Refinement)

- **[state]** No defined state for a stored kind outside the two options; upgraded installs have no CHECK and the cast is unchecked. **Recommendation:** normalise in `formFromPreset`, give the field an explicit unrecognised state, make the seed mapping total. *No*
- **[system]** The error surface for an invalid kind is a raw schema string. **Recommendation:** validate client-side with a reader-facing refusal. *No*
- **[feasibility]** R1's fallback contradicts AC 1 and re-asks a documented SDK behaviour. **Recommendation:** delete the spike, make AC 1 conditional on a Git source, state the fallback is silent. *No*
- **[feasibility]** R2's fallback documents a behaviour two DoD items deny. **Recommendation:** commit to the memoization, keep documentation only as a fallback. *No*
- **[feasibility]** R3 is not an unknown — the dialog has no project context. **Recommendation:** drop it or reframe as copy. *No*
- **[affordance]** No reuse candidate named; the two in-repo radio shapes disagree on focus. **Recommendation:** name the copied shape and why. *No*
- **[affordance]** No interaction-state, keyboard or disabled specification. **Recommendation:** enumerate states with honest N/A and pin them. *No*
- **[design-quality]** The list indicator has no placement and the obvious one is clipped by `truncate`. **Recommendation:** append to the meta line or use a conditional Pill. *No*
- **[design-quality]** The stale-copy claim is unsupported; only one of the three cited lines actually becomes false. **Recommendation:** restate as three precise edits. *No*
- **[flow]** The server fallback is not dead code, and the restart paths write no notice. **Recommendation:** state the consequence and give those paths an observable. *No*
- **[state]** The New preset flow silently inherits the default's kind, with no AC. **Recommendation:** add the AC and record the decision. *No*
- **[state]** The assign dialog keeps hiding the kind where a preset is chosen. **Recommendation:** extend visibility or add an explicit OUT entry. *No*
- **[composition]** The deferred effect has no surface: the composer names the preset but not its kind. **Recommendation:** state the kind where the reader meets the picker, and name the control's position. *No*
- **[feasibility]** The named lib module is not literally writable: the type is unexported and a declaration sibling is required. **Recommendation:** name both files and use indexed access. *No*

## 4. 🔎 Minor Clarifications

- **[data]** An omitted kind silently downgrades a worktree preset through the input default. **Recommendation:** drop the default or pin it with a contract test. *No*
- **[state]** The list grows a row inside a capped scroll box with no fade. **Recommendation:** render inline or adopt the existing fade hook. *No*
- **[design-quality]** AC 1 omits the documented base-branch limit of the chosen seed shape. **Recommendation:** state it beside the label bullet. *No*
- **[design-quality]** No token or scope statement for the new file, which the recursive design-token gate sweeps. **Recommendation:** name the tokens and state that no new surface is introduced. *No*

## 5. ✅ Strengths

- The vocabulary finding is the strongest part of the plan and is fully sourced — the stored value stays, the worktree is stated rather than delegated, and the quoted SDK limitation is verbatim.
- The dead-fallback claim is verifiable in the repository rather than assumed, and it makes the client-side seed the correct minimal intervention while leaving precedence untouched.
- Control placement is argued semantically (authoring vs assigning), not by taste, and correctly avoids letting a card dialog mutate a globally shared row.
- The option set is provably closed by schema, RPC enum and form union, so the two-option control needs no empty or unknown state on the normal path.
- Non-happy states are enumerated before the happy one, and the test shape pins written and submitted values with a fresh-subagent authorship rule.

## Notes on mode

Review mode is `Auto`, so per `references/auto-resolve-rules.md` every gap above is an internal recommendation and **no question is pushed to the user**. All of them are resolvable by filling a reasonable default or deleting a claim the repository contradicts; none requires a product decision from the human at this gate. The two that come closest — the honest name for the non-seeded option and whether the kind control is disabled for built-ins — are recorded here as recommendations rather than asks, and are the items most worth a human glance during Gate review.