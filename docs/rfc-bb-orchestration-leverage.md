# RFC: BB Orchestration Leverage (article-driven)

Status: partially implemented. P0 (token visibility) and P1 (automation
rules engine + board dialog) shipped; P2 child-thread surfacing shipped
(upstream `subagents.md` blessing + worker-history children rows);
stalled-paused escalation shipped (open paused events past 3 days carry
their age, same row — cards never relocate). Digest-as-inbox-kind and
lessons-file work below remain specified but unbuilt: they need an inbox
surface decision and a lessons home + entry-skill reader respectively.
Source article: Sawyer Hood, "software
factory" thread (2026-09-17): child-thread orchestration across providers,
long-lived scheduled managers, Automations/SlopCop/Workflows plugins,
drag-to-reparent, observability-first restraint.

Governing filter (non-negotiable, from stelow's papers table): anything
that increases observability without shared live state passes; anything
that creates swarm coordination fails — CooperBench (2-agent cooperation
25% vs 50% solo, monotonic decline), coordination overhead quadratic
(C(n)=0.023n², 50% tokens lost at n=7), Co-Coder (parallel speedup only
with cohesion-aware partitioning), CAID (+26.7% research parallelism).

## P0 — Cost/token visibility per card/worker

- **What**: surface BB `tokenUsage` per worker thread on the card (hero
  sub-line or worker section), no behavior change.
- **Primitives**: BB thread token-usage events (verify SDK exposure first;
  if absent, this item dies here — do not estimate from heuristics).
- **Principles**: pure observability, zero execution change.
- **Acceptance**: readout matches BB numbers on sample threads; hidden
  when the provider reports nothing (no zeros that lie).

## P1 — Event rules that propose, never decide (SlopCop-like)

- **What**: user-configured rules mapping events to draft actions —
  GitHub label → draft card in Triage; worker-PR CI green → notify
  (never merge); card idle N days → escalate to inbox.
- **Draft destination (locked)**: a drafted card parks in the **Inbox
  column** (board position, no worker, no burn) — never as an inbox feed
  item, and **rules never start workers** (starting unreviewed drafts
  would burn budget behind the human's back). Every rule-drafted card
  carries an origin marker ("Drafted from GitHub issue #X", source link)
  so it reads as proposed work, never as the user's own draft and never
  as a stalled card. Discovery rides the
  column count the tab bar already shows; no new badge path.
- **Stalled cards (locked semantics)**: a stalled card does NOT move
  columns — board position is never attention (repo doctrine), and
  relocating it to Inbox would falsify its lifecycle (a 5/8-scopes card
  is not "captured, not started") while mimicking unstarted drafts next
  to it — inviting restart/archive/delete of mid-flight work, or
  silent neglect as "not started yet". It
  raises/refreshes a `paused` inbox event pointing at the card's own
  recovery actions (retry/restart/reseed/discard), with the paused
  banner and needs-attention marker in place. Its code stays parked
  exactly where it is. If in-place attention ever proves insufficient,
  strengthen the signals (escalating copy after N idle periods, digest),
  never relocate the card: moves must mean lifecycle transitions
  initiated by user or worker, never timer side effects.
- **Code-safety invariant**: one card, one branch (`bb/` prefix) or one
  dedicated worktree — never auto-switch, auto-move, or auto-delete
  branches. A second card never touches another card's dirty checkout;
  cleanup is the explicit Discard action. Staleness is safe because
  nothing moves by itself.
- **Rules surface (open design point)**: board-level settings area,
  per-project; each rule = event + filter + draft/notify template.
- **Primitives**: `bb.background.schedule` (precedent: existing daily
  check), GitHub sync data, realtime/inbox (precedent: reconcile sweep).
- **Hard rules (from repo doctrine)**: nothing auto-imports; no gate
  bypass (a rule may prepare an approval/merge, the human still clicks);
  every rule action is an inbox event or draft, both reversible.
- **Acceptance**: rule fires produce exactly one draft/notification;
  disabled rules are inert; a fired rule never mutates workflow state.

## P2 — Observable fan-out for research/review tracks

- **What**: run each proposal/round/reviewer as a **BB child thread**
  (fresh context, independent output file, parent synthesizes) instead
  of in-worker subagents — same constraints, better substrate: live
  visibility per proposal, takeover per proposal, per-thread provider
  routing (cheap models for proposals, strong model synthesizes —
  matches band presets).
- **Upstream touch (small, required)**: `subagents.md` reference must
  bless BB-child-thread fan-out as an equivalent execution substrate
  under the identical constraints (fresh context, zero communication,
  independent files); skill bodies unchanged.
- **Plugin touch**: ledger records child thread ids per card; UI shows
  per-proposal status; synthesis still owned by the parent worker.
- **Forbidden**: any code-execution parallelism (sequential-code rule +
  CooperBench stand); shared live context between proposal threads.
- **Acceptance**: identical artifacts to in-worker fan-out on sample
  runs; per-proposal visibility + takeover demonstrable; cost readout
  (P0) shows the cheap-model routing.

## P3 — Board-health manager + lessons learned (digest, not execution)

- **What**: scheduled thread reviewing stalled/paused cards, posting a
  digest to inbox; aggregates `audit.md` retrospectives into a
  board-level lessons file the entry skill reads (extends stelow's
  Lessons-Learned cross-referencing from setup-time to board-level).
- **Primitives**: scheduler + inbox + file memory (never shared live
  context between cards).
- **Acceptance**: digest-only output (no state mutation besides the
  digest event); lessons file is additive context, never directives.

## Declined with reasons (do not reopen without new evidence)

- Code-defined orchestration replacing stages → forks single-source
  methodology, kills auditability. Cheap-model routing already exists
  via band presets.
- Parallel code execution via child threads → sequential-code rule,
  CooperBench, Co-Coder.
- Live worker reparenting across cards → breaks workflow-state
  ownership (`dir_hash`, `ownsWorkflowState`). Use continuity links
  (`@previous-worker` precedent): adopt *context* (link), never fuse
  execution.
- Auto-merge / auto-import → gate doctrine + explicit repo rule.

## Verification bar (all phases)

`npm run typecheck` + full `npm test` + `npm run lint` green;
FEATURES.md entry per user-visible behavior; English copy; no new
refusal paths without pin tests.
