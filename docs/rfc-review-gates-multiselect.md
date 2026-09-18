# RFC: Review Gates as Multi-Select (replacing the cumulative ladder)

Status: plan — not implemented. Motivation: the ladder cannot express
"only interface alternatives" or "product spec + tech plan" (each rung
implies all previous gates); the picker copy already promises
checkpoints-you-pick while the UI delivers take-it-all rungs.

## 1. UX answers (locked)

- **Pure multi-select works standalone** — presets are shortcuts, never
  requirements. No selection at all must behave exactly like today's
  `Auto` (LLM decides + receipts, never parks).
- **Select-all and clear-all buttons** on the picker; list starts
  **deselected**; the composer remembers the **last used** selection
  (localStorage, `STORAGE_KEYS` precedent like `lastTab` — per-user,
  per-composer surface).
- **Presets stay as one-click templates**: the 6 legacy rungs plus
  named shortcuts ("interface only", "spec + tech plan"). Presets write
  into the same multi-select state — they are not a second model.
- Options are real checkboxes (keyboard + screen-reader native, min-h-11
  targets), following the repo's radio/checkbox conventions — never a
  custom dropdown div.

## 2. Data model

- **Gate atoms**: `spec` (product gate + assumption asks), `interface`
  (interface pick + int-gate), `scope` (scope confirm), `tech`
  (plan-gate + technical questions), `diff` (diff gate). `diff` stays
  separate: Code Diff ≠ Tech Review (same reason `diff-gate` already
  skips independently).
- **Canonical storage**: array of atoms. Legacy ladder strings keep
  working, mapped both directions (Auto→[], Spec Gate→[spec],
  Interface Gates→[spec,interface], Scopes→+[scope], Tech Review→+[tech],
  Code Diff→+[diff]); unknown strings fail open (existing precedent).
- **Where it lives**: `state.md` + `stelow.json` config (alongside today's
  `review_mode`), card creation input, `bb.storage.kv`
  `board-workflow-defaults` (safeParse migrates stored ladder strings via
  the same map). Appetite untouched — depth vs breadth stay orthogonal.

## 3. Upstream changes (required first — gates semantics live there)

- `human-gates.md`: mode→gates table becomes set semantics (which atoms
  wait, per combination — not a ladder).
- `transitions.md` Gate Conditions + `proposal-structure.md` Mode matrix:
  same rewrite (they already disagree in places; the matrix in
  proposal-structure is canonical per human-gates rule 1).
- `stages.yaml`: stages keep `modes` lists during transition; contracts
  (`requiredForStage`) resolve ladder strings through the compat map
  until upstream speaks gate atoms natively (follow-up, not blocker).

## 4. Plugin changes

- **Schemas/RPC**: `reviewModeSchema` enum → set of atoms (accept legacy
  strings, normalize on read); `createCard`, board defaults, reseed
  paths carry the set through.
- **UI**: `WorkflowSettings` radio ladder → checkbox group + Select
  all / Clear + preset templates; composer default = last used
  (localStorage), board default = kv.
- **Enforcement**: `MODE_SKIPS` (string→modes[]) becomes a per-gate
  predicate over the set; `stage-skips` reasons name the missing gate,
  not the rung; `splitActionState` and auto-continue untouched
  (stage-gated, not mode-gated).
- **Prompts**: `INTERFACE_PICK` rewritten in set language
  ("for each selected gate: …; unselected gates: LLM decides with
  receipt, never parks"), pinned by `prompt-contracts` as today.
- **Contracts**: `requiredForStage` resolves explicit sets directly;
  ladder strings via the compat map (tested both directions).

## 5. Semantics (locked)

- Empty set ≡ Auto: LLM decides everything with receipts
  (`assumptions_resolved`, `selected_by: llm`, approval receipts);
  advance guards verify receipts exactly as today.
- Each selected atom behaves exactly like its ladder rung did
  (same gates, same asks, same evidence rules) — multi-select changes
  *which* gates wait, never *how* a gate works.
- Unknown atoms/strings fail open (precedent), never invent a wait.

## 6. Rollout

1. Upstream RFC (model + matrices) → 2. plugin behind the compat map
   (ladder in, sets internally) → 3. UI multi-select + presets →
   4. prompts/contracts/tests → 5. upstream native atoms (follow-up).

## 7. Verification

- Matrix test: every atom × on/off × representative stages, plus all 6
  legacy rungs mapping to identical behavior as before (no-regression
  guard — the strongest test in this RFC).
- Fixture `state.md` files per path (AGENTS.md transitions pattern).
- `npm run typecheck`, full `npm test`, `npm run lint` green;
  FEATURES.md entry (user-visible behavior change).
- Risks: partial migration (string sneaking past normalization —
  centralize in one `normalizeReviewGates` function, tested); prompt
  drift (prompt-contracts pins the new text).
