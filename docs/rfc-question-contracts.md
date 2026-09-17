# RFC: Question Contracts (upstream + plugin)

Status: partially implemented (P0 done, P1–P3 pending — see §10).
Goal: make it mechanically knowable which questions must happen, in which
skills/stages, under which situations and configs, so any LLM (or host)
can implement and verify enforcement.

## 1. Problem

Upstream stelow decides *when to ask* by review mode, but only in prose
(`human-gates.md`, skill bodies). The bb plugin enforces *refusals*
(`context-ask-gate`, `gate-ask-evidence`, per-option `selection` rule) and
*skips* (`stage-skips.mjs` `MODE_SKIPS`), never *requirements*: no code
verifies that a mandated ask actually happened before `advance` leaves the
stage. A worker that silently skips the interface pick in a gated mode, or
a plan-gate with zero answered gaps, advances today.

## 2. Governing insight: two orthogonal axes

- **Appetite** scales *depth*: how many (1/3/5 interfaces, top-3 vs top-5
  assumptions). Never who decides.
- **Review mode** scales *decider*: human (structured ask, parks) vs agent.
- **`Auto` ≠ "no question".** It means *agent-resolved with receipt*:
  `assumptions_resolved` frontmatter, `selected_by: llm`, approval
  receipts under `.stelow/approvals/`. Receipts are **files**, therefore
  verifiable in code without bugging the human. This is the enforceable
  core: verify receipts, not intentions.

## 3. Ownership split

| Layer | Owns | Must not |
|---|---|---|
| Upstream (`calionauta/stelow`) | Machine-readable question contract per stage (schema §5), methodology prose stays advisory | Host-specific enforcement |
| Plugin (`bb-plugin-stelow`) | Mirror of the contract + enforcement at choke points it owns (`advance`, ask gates), pinning the vendored copy via test (precedent: `stage-skips.mjs` ↔ `transitions.md`, test `stage-skips`) | Its own methodology fork (`skills/` stays synced, never hand-edited) |

## 4. Upstream schema proposal (`stages.yaml`, additive only)

```yaml
stages:
  - name: selection
    # ... existing keys (tools, primary_actions, transitions) untouched ...
    questions:
      - id: interface-pick
        kind: human-ask            # human-ask | agent-receipt | skip
        modes: ["Product Spec + Interface Gates", "Product Spec + Interface + Scopes", "Product Spec + Interface + Tech Review", "Product Spec + Interface + Tech Review + Code Diff"]
        appetite: [Core, Complete] # Lean decides inline (single proposal)
        evidence: per-option       # every option carries preview+artifact
        receipt: interfaces/selected-interface.md
      - id: interface-pick-auto
        kind: agent-receipt
        modes: [Auto, "Product Spec Gate"]
        receipt: interfaces/selected-interface.md  # with selected_by: llm
```

`kind` vocabulary (closed): `human-ask` (blocks until answered),
`agent-receipt` (agent resolves, receipt file proves it), `skip`
(stage bypassed for these modes — mirrors `MODE_SKIPS`).

## 5. Inventory (verified vs TODO)

| Stage / skill source | Upstream rule (verified) | Mode behavior |
|---|---|---|
| shape entry (Assumption Check, `shape-up/SKILL.md`) | Auto/Gate: auto-resolve, no questions; Interface Gates: top-3 + recommendation; Scopes/Tech: top-5 | agent-receipt vs human-ask |
| shape exit (Scope Adjustment, post-gate IN/OUT multiSelect) | Human confirm only Scopes+ (`human-gates.md` Pattern 3); else LLM adjusts | human-ask vs agent-receipt |
| critique gaps (`plan-critique/SKILL.md` mode caveat) | Auto/Gate: internal recommendations; Interface Gates+: top-N user questions | agent-receipt vs human-ask |
| interface pick (Pattern 2, `interface-alternatives/SKILL.md` + `human-gates.md`) | Auto/Gate: LLM adopts hybrid; Interface Gates+: structured ask, every option with wireframe preview + proposal artifact | agent-receipt vs human-ask, per-option evidence |
| tech-planning alignment (`tech-planning/SKILL.md`) | Stack inferred, no questions; auto-update vs ask per `alignment-check.md` | TODO: read fully |
| plan-gate / tech review asks | Evidence-required asks; Tech Review+ includes technical questions | TODO: enumerate |
| scope Pattern 3 ask shape | multiSelect IN/OUT | TODO: read ask-patterns Pattern 3 |
| triage / select / setup / context asks | Triage intent question when ambiguous (prompt discipline); context skips refactor/bugfix | TODO: read `orchestrator/stages/{triage,select,setup,context}.md` |
| verification / diff-gate / execution asks | Unknown | TODO: read stages + `transitions.md` Gate Conditions |

## 6. Plugin design

New lib `lib/question-contracts.mjs` (pure, node-tested):
- `loadQuestionContracts()` reads the vendored
  `skills/stelow-workflow-orchestrator/stages.yaml` (`questions:` blocks).
- `requiredForStage({ stage, reviewMode, appetite, kind })` returns
  `[{ id, kind, receipt }]` — the checklist for this transition.
- Pin test: vendored contract ↔ lib expectations (same shape as
  `tests/stage-skips.test.mjs` stub routes + gate table).

Enforcement points (server.ts):
- `advanceCard`: after the helper `advance` succeeds, resolve the
  checklist for the *destination* stage context (the stage just worked):
  every `agent-receipt` id must have its receipt file present and fresh
  (written after stage entry — compare mtime against stage entry from
  `state.md` history); every `human-ask` id must have an answered question
  (inbox `question` events resolved `answered`, or expired-answered).
  Refuse with the named fix (what is missing + which ask/command produces
  it). `--force` escapes stay available where the methodology allows.
- Ask-time gates stay as-is (`context-ask-gate`, `gate-ask-evidence`
  incl. per-option `selection`); optionally unify behind one `askGate`
  dispatcher if a third rule appears (YAGNI until then).
- No new UI widgets: pending/expired questions, receipts-as-artifacts,
  and the timeline skip reasons already render every state.

## 7. Rollout (value order, each independently shippable)

- P0 — `selection`/`interface` receipts: verify `selected-interface.md`
  (or answered selection ask) on advance past `selection`/`int-gate`
  in gated modes; verify `selected_by: llm` receipt in Auto/Gate.
- P1 — plan-gate response evidence: require ≥1 answered gap question
  (or explicit zero-gap receipt) before leaving `plan-gate` in Tech
  Review+; Auto/Gate require the critique report file only.
- P2 — scope Pattern 3: require answered scope ask (or agent receipt)
  per mode before leaving `scope` in Scopes+.
- P3 — assumption receipts: require `assumptions_resolved` frontmatter
  (Interface Gates+) or auto-resolve notes (Auto/Gate) before leaving
  `shape`.

## 8. Verification per phase

- `tests/question-contracts.test.mjs`: matrix stage × mode × appetite
  against fixture `state.md` files (AGENTS.md transitions pattern:
  all paths live with fixtures before shipping guard changes).
- Extend `tests/stage-skips.test.mjs` pinning if `MODE_SKIPS` grows.
- `npm run typecheck`, `npm test` (full), `npm run lint` green.
- FEATURES.md entry per user-facing behavior change (agent-only
  receipts need none; new refusals do).

## 9. Risks / non-goals

- No methodology fork: contract text lives upstream; the plugin only
  mirrors + enforces. A drift fails loudly in the pin test.
- `--force` and split mechanics keep their explicit overrides.
- No enforcement for research/explore tracks (stageless by design).
- Unknown review modes fail open (existing `skippedStages` precedent).

## 10. Implementation status

- P0 done: upstream `questions:` blocks for `selection` (synced at
  `data/stelow-source.json` commit `4fc5a17`), plugin mirror
  `lib/question-contracts.mjs` + `tests/question-contracts.test.mjs`
  (wired as `test:contracts`), per-option evidence gate for selection
  asks (`lib/gate-ask-evidence.mjs`), single-source `INTERFACE_PICK`
  prompt clause. Do NOT re-implement.
- P1–P3 pending: blocked on §5 TODO inventory + upstream `questions:`
  blocks for those stages. Enforcing without them would invent
  methodology in the plugin — refused by design (see §9).
