---
selectedBy: llm
reviewMode: Auto
reviewGates: []
receipt: interfaces/contrast.json#contrast-round-1
stage: selection
selectedOption: opt-3
---

# Selected interface — preset environment kind

*Readable view of `interfaces/selection.json`, which is the source of truth for
the decision. This document is the complete proposal for the chosen shape.*

## The pick

**`opt-3`** — an on/off control that reuses the concept's declared name
(`ISOLATED_WORKTREE_LABEL`) and leaves the **off state silent**.

## 0. Work Pattern

The pattern is **configuration**, not layout. This is a settings dialog field,
not a decision surface: one person, one preset, one persisted value, and a
default that later work inherits. The pattern it has to get right is therefore
the *state* pattern underneath it — a checkbox that means "and BB decides"
when unchecked, which is a two-state machine with an implicit third state
(unrecognised stored value) that no checkbox can render.

That is why the design work went into the vocabulary rather than the
arrangement. A configuration field has one job: be true about what it will
cause. Everything below follows from taking that job literally.

## 1. Philosophy

> **A control may not claim more than the system will deliver.**

Your request named two options — *"project checkout" or "worktree"*. That pair
cannot both be honoured, because the stored value `project-default` means the
shared checkout in Stelow while bb's `{type:"project-default"}` means a managed
worktree when git permits (host commit `893a05a`). Verified at
`lib/tracks.mjs:94-100`: any `project-default` is stored `managed`, and
`worktree` is reached only through `host` + `managed-worktree`.

So a labelled pair would promise a checkout and hand you a worktree — on any
git project. That is the exact failure your request set out to fix, arriving
through the front door.

Two ways out, and the difference between them is structural rather than
stylistic:

- **Word it carefully** — say "Uses BB's own default for this project". Honest,
  but still a promise that must be maintained forever, and the explanation is
  what produced the broken label in the first place.
- **Claim nothing** — unchecked means nothing is asserted. The failure mode
  becomes impossible rather than merely unlikely.

This design takes the second. The control has exactly one promise to keep, and
it is one the code keeps today.

## 2. Breadboarding

- **Owner:** the Agent Presets dialog, inside the existing open form body.
  Not the shared `PresetExecutionPicker`: that component is used by the card's
  assign dialog, which *chooses* a preset. This field *authors* one, and a card
  dialog must not be able to mutate a globally shared row.
- **Placement:** after the execution picker, inside the same `grid gap-2` body.
  No new border, no new section — the repo's surface rule wants a section to
  keep one tone, and this is the same form body it always was.
- **Density:** one row plus one sentence. The sentence changes with the state,
  so the field explains itself in place rather than behind a disclosure.
- **Voice:** one sentence per state, each saying what *actually happens*.

## 3. ASCII sketch

```
  Manage agent presets
  ┌────────────────────────────────────────────────────────┐
  │ Presets (3)                              [ New preset ] │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │ Default        openai/gpt · high · full           │  │
  │  │                        [default] [Edit] [Delete]  │  │
  │  ├──────────────────────────────────────────────────┤  │
  │  │ Isolated        openai/gpt · high · full          │  │
  │  │              [worktree]  [Edit] [Delete]         │  │
  │  └──────────────────────────────────────────────────┘  │
  │                                                        │
  │  Edit Isolated                          [New preset][Hide]│
  │  ┌────────────────────────────────────────────────────┐ │
  │  │ Name      [ Isolated                          ]    │ │
  │  │ Provider   [ openai ▾ ]  Model [ gpt ▾ ]          │ │
  │  │ Reasoning  [ high ▾ ]   Permission [ full ▾ ]     │ │
  │  │                                                    │ │
  │  │ [x] Isolated worktree                              │ │
  │  │ Cards start with this preset open a worktree of   │ │
  │  │ their own. You can still change it when creating  │ │
  │  │ a card.                                           │ │
  │  │                                                    │ │
  │  │                            [ Close ] [Save changes]│ │
  │  └────────────────────────────────────────────────────┘ │
  └────────────────────────────────────────────────────────┘
```

Unchecked, the sentence changes to *"Off: cards start in whatever environment BB
picks for the project."* — a statement about BB's behaviour, not about which
checkout the card will get.

## 4. Interaction Flow

```
  open Agent Presets
        │
        ├─ list shows a `worktree` pill per worktree preset   ← visible without opening
        │
        └─ [Edit] ──> form opens on that preset's current value
                          │
                          ├─ toggle ──> writes environmentKind locally
                          │             sentence updates in place
                          │
                          ├─ [Save] ──> validation ──> upsertPreset ──> list refreshes
                          │
                          └─ built-in preset ──> control disabled,
                                                   sentence names the cascade
```

A card created afterwards opens its composer already seeded on the worktree.
The person can change it, and their choice is what the card gets — the seed is
a starting point, never a rule.

## 5. Trade-Off

**Recommended: `opt-3`, the silent on/off control.**

| # | Option | Gains | Costs | Verdict |
|---|---|---|---|---|
| **A** | **opt-3 — on/off, off state silent** | The unearned promise becomes structurally impossible: nothing is claimed, so nothing can be unkept. Inherits the concept's name from its declared single source, so the preset editor and the import dialog cannot drift. Inherits `min-h-11` / `cursor-pointer` by copying them onto the label, not by reusing the component. | The off state carries no sentence, so a reader who has never seen the form learns nothing about what off does. On a grouped control, "neither option selected" could have been a *visible* third state; here the unrecognised case lives in help text alone. A visible reference cycle: the import dialog's help text points at Agent Presets. | **Chosen** |
| **B** | opt-2 — two-option radio-card | A better unrecognised-value state (a third visible "neither selected"). Keeps a spoken explanation of the off state. | Carries the *same* inexpressible-promise problem as A, in weaker form. Forks the isolated-worktree vocabulary away from the module that declares itself its single source. A card landing where BB's own default put it is not a defect to be warned about. | Rejected |
| **C** | opt-4 — `ChoiceCards` house style | Legitimate and verified accessible; consistent with the surfaces this dialog already sits next to. | Still a two-option control, so still needs an off-state sentence. It refutes the spec's false uniqueness premise without solving the problem that premise was attached to. | Rejected |
| **D** | opt-1 — your literal "Project checkout / Worktree" pair | Exactly what you asked for; fully buildable, since storage, the RPC enum and the form union all carry it. | **Invalid as a promise.** On any git project, "Project checkout" hands you a worktree and the card is stored `managed` — a different word than the control promised. | Recorded, not dropped |

## 6. Smell Audit

- **Mystery name** — "Isolated worktree" is imported from
  `isolated-worktree-check.tsx`, whose comment declares itself the single source
  for exactly this concept. One place to rename.
- **Stale reassurance** — the reused *benefit* and *details* strings were
  **excluded**, not reused. "The agent works on a separate copy" describes an
  agent and a card; on a preset there is no agent yet, and the person may
  change the setting. The details line tells the reader to create the very
  preset this dialog authors. Both are false in this location.
- **Hand-waved state** — the unrecognised stored value is reachable (upgraded
  installs add the column with `ALTER TABLE` and no `CHECK`; the CLI casts its
  flag blindly). The field names it and the save refuses it, rather than
  silently normalising it away.
- **Control before consequence** — the built-in case is disabled *and* explains
  why, because flipping it re-routes every auto-started worker and becomes the
  inherited kind of every preset created afterwards.
- **Pretending** — the strongest smell this design removes is the one your
  request contained: a label promising a checkout the card will not get.

## 7. State Coverage Table

| State | Behaviour | Tested by |
|---|---|---|
| On | Checked; seeds `host/managed-worktree`; sentence says the picker opens on a worktree you can change. | mapper assertion + the seeded-value test |
| Off | Unchecked; prop omitted entirely, so BB resolves its own default byte-for-byte as today. | mapper returns `undefined` |
| Unrecognised stored value | Unchecked, sentence names the value, save refuses with a message naming both options, RPC never called. | refusal assertions |
| Disabled while saving | `disabled={busy \|\| builtIn}` | interaction-state pin |
| Built-in preset | Disabled, sentence names the cascade | interaction-state pin |
| Worktree preset in the list | `worktree` pill beside the meta line, never inside the truncating span | row indicator pin |
| Card started afterwards | Seeded, and the person may change it | seed wiring + `selectCardEnvironment` unchanged |
| Personal / exploratory project | Uses the exploratory workspace; the substitution is **silent**, recorded as a known limit | documented, not tested — the producing code is out of this card's scope |

## Superseded clause

`scope-map.json` → `env-kind-control` previously read *"copying
`strategy-picker.tsx:64-104`, the only in-repo radio shape yielding WCAG 2.2
focus appearance today"*. **That uniqueness claim was false** and is withdrawn:
`creation-settings.tsx:91` (`ChoiceCards`) carries the identical focus treatment
plus `min-h-11` and `cursor-pointer`. Corrected at source in
`plans/spec-product.md` via `scope-map-challenge.json` — challenged, not edited.

## Open, carried forward

- No first-reader pass distinguishes a silent off state from "not set up yet".
  This pick rests on structure, not on observed comprehension.
- Whether the visible reference cycle suits the author of the isolated-worktree
  module is unasked.
- The card's assign dialog still hides which kind each preset carries.