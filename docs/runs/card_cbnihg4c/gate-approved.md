---
approved: true
approved_at: "2026-09-30T19:24:00Z"
approved_via: auto (Review Mode=Auto)
stage: gate
spec: plans/spec-product.md
spec_revision: 2
selected_by: llm
contract: product-gate
---

# Product gate — approved (Review Mode = Auto)

`review_mode: Auto` and `review_gates: []` in `state.md`, so per
`stages/gate.md` gate:1 this gate is **skipped, not parked**: no
`visual_review` call, no chat question, no human ask. The LLM decides and
records the receipt.

## What was decided

`plans/spec-product.md` revision 2 is accepted. Its three capabilities:

1. **Author the field.** A `PresetEnvironmentKindField` in the manager form,
   writing `form.environmentKind` — which the save path already sends.
2. **Honest vocabulary.** The control is an explicit on/off toggle whose off
   state promises only "BB's own default for this project". The worktree is
   *stated* as `{type:"host", workspace:{type:"managed-worktree"}}` rather than
   delegated to bb's redefinable `project-default` token.
3. **Seed, never override.** `defaultEnvironment` on all three composer
   dialogs — the SDK's own "a seed the user can change". `selectCardEnvironment`
   untouched; the `card-environment.mjs:1-11` invariant intact.

## Claims verified before approval

Per `gate:5`, code references in the spec were re-verified against the
repository by the coordinator, not accepted on a subagent's word:

- ✅ `server/workers.ts:94-104` — `workerEnvironment` returns
  `host/unmanaged/path` for `project-default`, `{type:"project-default"}`
  otherwise. As claimed.
- ✅ `components/settings/preset-manager-form.tsx:59-76` — the form body
  renders exactly two controls and writes neither. The core premise holds.
- ✅ `components/settings/preset-manager-list.tsx:41` — the meta content sits
  inside `min-w-0 flex-1 truncate`, so a second line there would be
  ellipsised. The critique's placement finding is correct and the spec now
  specifies a conditional `Pill`.
- ✅ `lib/tracks.mjs:94-100` — `describeCardEnvironment` returns `managed` for
  any `project-default` and reaches `worktree` only for
  `host` + `managed-worktree`. The "Project checkout" label was an unearned
  promise; the toggle resolves it.
- ❌ **CORRECTED** — the spec's round-1 claim that
  `tests/component-rule-seams.test.mjs` and
  `tests/card-creator-environment-optional.test.mjs` are "wired into no npm
  script" is **false**. `package.json` `test:contracts` invokes both, `npm test`
  chains `test:contracts`, and `tests/suite-wiring.test.mjs` fails the build on
  any unwired test file. Withdrawn in revision 2 along with the DoD item, AC and
  OUT/IN row that rested on it.

**Claims verified with corrections applied** (1 correction, above).

## Two items flagged for the execution stage

Not blocking — both are already recorded in the spec's OUT table with their
blast radius named, and neither needs a product decision:

- `describeCardEnvironment` reading `managed` for composer-unstarted paths is a
  permanent per-path label divergence. Making it prefer preset intent touches
  stored card state and is a separate change.
- `server/workers.ts:103` keeps delegating for non-composer starters (import,
  CLI, restart/respawn), which write no substitution notice. Recorded as a
  known behaviour, not silently accepted.

## Provenance

Spec and critique were produced by `space-bunny-free` in this card's run
directory. Every load-bearing claim was re-checked directly against the
checkout before this receipt was written.

---

**Next stage:** scope. `plans/spec-product.md` revision 2 is frozen for the
remainder of this gate cycle; a change to it requires a new version.