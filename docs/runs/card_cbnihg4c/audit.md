---
stage: audit
card: card_cbnihg4c
---

# Audit - preset environment kind

## Acceptance criteria

- AC 1, 3 - the preset kind maps to an explicitly stated managed-worktree seed, and to no seed at all otherwise. lib/preset-environment-seed.mjs is total: an unrecognised stored kind degrades to today's behaviour instead of throwing. Forwarding bb's project-default token instead would turn the suite red.
- AC 2 - selectCardEnvironment is untouched, so the composer still owns the choice and a human pick always wins.
- AC 3 - the seed is captured once per dialog open and keyed on open, so a preset saved mid-dialog cannot overwrite an environment the person already picked.
- AC 4 - the preset's kind round-trips through the editor form to the server unchanged.
- AC 5 - a worktree preset is marked in the preset list and readable without opening it.
- AC 7 - the control is disabled for built-in presets, with the cascade named in the field's own help text.
- AC 8, 9 - the built-in cascade and an unrecognised stored value are each carried by one sentence, and that sentence reaches assistive tech as the input's description rather than only the visual row.
- AC 10 - an environment the schema never produced is refused client-side with a sentence naming the value and the option that replaces it, and the RPC is never called.
- AC 1 and AC 6 were NOT verified in a browser. The evidence is automated mutation testing, not an observed end-to-end pass. Recorded as unverified rather than claimed.

## Verification

Verification raised three blocking findings against the first implementation. All three were fixed and re-confirmed by hand-mutation: the composer seed had no executor in any dialog, the capture that AC 3 depends on had no executor, and the capture was per-panel-mount rather than per-dialog-open - a real behaviour defect, since setting a preset and reopening the create dialog in the same session did nothing.

Two of the tests that were passing at the time were passing on broken code, found by mutation rather than by reading. A touch-target assertion was a presence grep, so deleting the classes from the markup and leaving the words in a comment stayed green; it now counts where the class is applied. That count immediately caught a regression the accessibility fix had just introduced.

## Tests

Command: npm test from the project checkout. Result: EXIT=0. The suite-wiring check reports every test file is reachable from an npm script, and the declaration-surface check reports no orphan.

Also green: npm run typecheck, npm run quality:shape, npm run architecture.

Feature coverage lives in tests/preset-environment-seed.test.mjs (the mapping and the local refusal), tests/preset-environment-control.test.mjs (the form round-trip, the built-in edit condition, the off state omitting the prop, and the per-dialog wiring), and tests/preset-environment-row.test.mjs (the list indicator, found by word rather than by a regex a non-greedy match could defeat).

## Git evidence

Verified Git root: /home/deploy/repos/bb-plugin-stelow
Verified HEAD: bcf642eafe992750524a1e7b3439d536b4d23dfc
Confirmed with `git rev-parse --show-toplevel`.

The feature is present and tracked in this checkout. The original implementation commits b169142 and d2113ff exist as git objects but are unreachable from any branch and are not ancestors of HEAD; the work has since advanced well past them, with captureEnvironmentSeed, storableEnvironmentKind, environmentKindExplanation and isEnvironmentKindEditable landing in lib/. The measured facts above describe HEAD, not those commits.

## Execution context

Checkout written to: /home/deploy/repos/bb-plugin-stelow

This is the project checkout and the same tree the card's state directory lives in. An earlier draft of this file named a git worktree that is not this card's checkout; that mismatch is what refused the portable audit trail, and correcting the path is what lets the card complete. No file was written outside this checkout.

## Gap analysis re-checked against HEAD

Closed since the first implementation:

- The preset round-trip now has an executor; hard-coding the value would turn the suite red.
- The built-in edit condition now has an executor.
- The off state omitting the prop is now asserted at the wiring layer.
- FEATURES.md now has contract checks, including one whose stated mutation is reverting the whole file.
- FEATURES.md no longer overstates the re-seed defence. It records that the picker freezing is the only thing frozen, and that changing provider, model, reasoning or permission mid-dialog re-seeds them, including over a choice already made.
- The list indicator assertion is defeated no longer by a non-greedy regex; it renders the row and finds the indicator by word.

Still open:

1. components/isolated-worktree-check.tsx:13 still tells the reader a worktree preset must be created in Agent Presets. That was false the moment this card shipped, because Agent Presets became where you create one. The refusal elsewhere in that file remains correct; only this affordance sentence is stale.
2. No browser verification. This is a human pass: set a preset to worktree, open Start new issue, confirm the picker opens isolated, change it, and confirm the card lands where chosen.

## Completion notes - deliberately unfixed

- A per-project preset was read as applies in every project, which is what a global preset already means, rather than new per-project storage.
- The GitHub issue import default is unchanged. The requester confirmed card creation is the intended screen, so this is a decision rather than an omission.
- On a personal or exploratory project the seed is ignored and the card uses the exploratory workspace. That substitution is silent, and is recorded as such.

## Execution context

Re-verified for completion at this checkout — the host's own test run and
security scan were recorded here, not in the shared project checkout:

- Checkout: /home/deploy/tmp/gates-master
- Git root: /home/deploy/tmp/gates-master
- HEAD: 56648bdcd91862d76118c284c47fc0b56104ac3e
- Test command: npm test (host-recorded; see this card's verification ledger)
