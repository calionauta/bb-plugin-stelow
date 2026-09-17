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

| Stage / source | Trigger and exact upstream rule | `Auto` / `Product Spec Gate` | Interface Gates | Scopes / Tech / Code Diff | Contract status |
|---|---|---|---|---|---|
| `triage` (`stages/triage.md:7-16,37-64`) | Multi-item input (or explicit invocation): show all items and ask the organization decision. “Ask the user to verify the list FIRST.” | config is not declared yet | same | same | **Not contractable yet:** predicate is input shape, not review mode/appetite; `questions:` has no condition field. |
| `select` (implemented by `stages/selection.md:6-8,38-56`) | Only after triage yielded candidates: “User picks one”, then routes remaining candidates. | config is not declared yet | same | same | **Not contractable yet:** conditional candidate pool and pre-config stage. |
| `setup` (`stages/setup.md:279-283,327-331,416-447`) | Appetite and review mode are two mandatory, separate human asks before configuration exists. Stage selection is human-only in Interface Gates+; safe-change is human-only in Scopes+. | appetite/review: human; stage selection: agent; safe-change: skip/agent | appetite/review + stage selection: human; safe-change: agent | appetite/review + stage selection + safe-change: human | **Not an advance contract:** these asks establish the very config used to resolve later contracts. Deferred-inbox/resume asks are also conditional (`setup.md:19-48,160-174`). |
| `context` (`stages/context.md:23-30,45-58`; `ask-patterns.md:37-76`) | Pattern 1 is an explicit human multi-select unless `Lean + Auto`, where it skips. Domain-library ask is only for detected domain signals (`context.md:82-111`). | Lean: skip; Core/Complete: human ask per `context.md` | human ask | human ask | **Blocked by upstream conflict:** `transitions.md:234-237` says Product Spec Gate, Scopes, and Code Diff context are skipped entirely, contradicting `context.md`. Resolve before a block. |
| `shape` assumptions (`shape-up/SKILL.md:111-127`) | Auto/Gate: auto-resolve and write assumptions in spec; Interface Gates: top-3 human asks; Scopes/Tech: top-5 human asks. | agent receipt (`assumptions_resolved`) | human ask | human ask (Code Diff omitted) | **P3 candidate, but incomplete:** Code Diff is absent from the source matrix, so do not extend it by inference. |
| `critique` gaps (`plan-critique/SKILL.md:221-262`; `ask-patterns.md:462-468`) | Auto/Gate resolves all gaps and saves `critiques/critique-report.md`; Interface Gates asks top-5 moderate/critical; Scopes/Tech asks top-5 moderate and top-3 critical. | agent receipt `critiques/critique-report.md` | human asks when qualifying gaps exist | human asks when qualifying gaps exist (Code Diff omitted by `plan-critique`) | **P1 evidence exists, but conditional:** no-gap and Code Diff semantics need an explicit upstream contract/receipt before enforcement. |
| `scope` Pattern 3 (`ask-patterns.md:178-214`; `human-gates.md:22-24`) | After gate, multi-select “Remove from IN” and “Add to IN”; “only when review mode requires IN/OUT confirmation.” | agent resolves | agent resolves | human ask in Scopes+ | **P2 candidate:** source does not define an agent receipt file for lower modes; add one upstream before checking it. |
| `planning:15` alignment (`references/alignment-check.md:53-89`) | Only `product_needs_update` / `blocking` ask. Auto/Gate update spec; Interface Gates+ ask (with progressively detailed impact). | agent updates/logs a receipt only if misaligned | human ask only if misaligned | human ask only if misaligned | **Conditional contract needed:** no required interaction when aligned; table omits Code Diff while prose says “>= Interface Gates” (`:71`). |
| `plan-gate` (`stages/plan-gate.md:3-26`) | Visual-review receipt, not a structured human ask; Tech/Code Diff only per stage prose. | skip | skip | visual-review receipt | **Blocked by upstream conflict:** `transitions.md:242` says “others” (including Scopes) block, while stage prose explicitly skips Scopes. P1 must not turn this into an ask contract. |
| `execution` (`stages/execution.md:140-141,172-175,203-253`) | Start is automatic: “DO NOT ask … what would you like to do next”. It only says higher modes “may add human approval checkpoints per PR”; no concrete ask or receipt is specified. | agent/automatic | unspecified contingent checkpoints | unspecified contingent checkpoints | **No contract:** insufficient methodology definition. |
| `verification` (`stages/verification.md:296-305`) | P0/P1 findings: Auto/Gate fix/document; Interface Gates escalate; Scopes need fix or explicit acceptance; Tech/Code Diff block. | agent receipt/documentation | conditional human escalation | Scopes conditional human acceptance; Tech/Code Diff block | **No contract:** trigger, question form, and durable receipt are unspecified. |
| `diff-gate` (`stages/diff-gate.md:3-31`) | Code Diff only; visual review is the gate. A dismissed/ambiguous result produces a contingent human ask. | skip | skip | Code Diff: visual-review receipt; contingent ask on dismissal/ambiguity | **No contract:** gate result is the predicate and no standardized receipt/ask identity exists. |

### Inventory conclusion (2026-09-17)

The quoted sources confirm P1–P3 must remain upstream-first. The ready
direction is: define an explicit zero-gap/critique receipt for P1, define an
explicit lower-mode scope-adjustment receipt for P2, and add the missing Code
Diff behavior to the shape-assumptions matrix for P3. Until those definitions
and the `context` / `plan-gate` conflicts above are resolved upstream, plugin
enforcement would invent methodology and can falsely park live workflows.

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
- Upstream contracts published (eaea821, 0.60.0-alpha, synced):
  `questions:` blocks for `shape`/`critique`/`scope`, `gap_verdict` and
  `scope_adjustment` frontmatter receipts, Code Diff coverage, `context:5`
  canonical in transitions, no plan-gate in Scopes. Plugin mirror
  extended; `contextAskGate` relaxed to the permitted reduced ask;
  `NON_AUTO_SKIPS` emptied (worker-side `context:5` decides).
- Still pending: advance-time enforcement linkage (P1–P3) — the mirror
  is read by nothing in `advanceCard` yet, deliberately. Wiring it is
  the remaining work; see the handoff below.
- Enforcement wired (eaaf062): pure `lib/advance-contracts.mjs` +
  fixtures under `tests/fixtures/question-contracts/`, checked
  pre-helper in both `advanceCard` RPC and CLI `bb stelow advance`
  (skipped for `--dry-run` and cardless invocations). Boundary reads the
  real `history.at` entries; unreadable state/config fails open.
- Residual simplifications (accepted, harden later): a human-ask contract
  is satisfied by any question answered since stage entry (not matched
  per contract id); in-flight legacy cards may refuse once post-deploy
  and self-heal on the named fix.
