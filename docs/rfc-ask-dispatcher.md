# RFC: Ask-Gate Dispatcher + Per-Question Contract IDs

Status: Phases 1–2 implemented. Phase 3 is intentionally deferred until real
usage shows that exact contract-id enforcement is needed; ad-hoc questions
remain supported. Goal: one decision point for every ask refusal, then exact
matching of answers to question contracts — without breaking ad-hoc
questions, standalone workers, or the fail-open doctrine.

## 1. Current pipeline (verified, `server/plugin-runtime.ts` ask branch)

Ordered gates, first refusal wins:

1. Ownership/archived (`cardRow` lookup; archived refuses).
2. Duplicate guard (`questionOpenGuard`, `lib/question-presence.mjs`):
   refuses when a live interaction or unanswered expired question already
   shows a form. Reads the provider (`fetchPendingAsks`); a failed read
   refuses too ("retry this same ask once"). `--force` does NOT bypass.
3. Intent gate (`contextAskGate`, `lib/context-ask-gate.mjs`): kind/
   intent/stage/tag/forced. Currently fail-open for everything except
   force/split/kind routing (upstream `context:5` owns the discipline).
4. Evidence gate (`gateEvidenceGate`, `lib/gate-ask-evidence.mjs`):
   per-option evidence at `selection`, single evidence elsewhere; `--force`
   bypasses.
5. Split branch (`splitEligibility` + shape checks): validates AND persists
   (`split_proposals` row, question rewrite). NOT part of the dispatcher —
   it executes, the dispatcher only decides.

## 2. Phase 1 — Dispatcher (implemented)

`lib/ask-gate.mjs`: `decideAskGate({ liveCount, expiredCount, kind,
intent, stage, tag, forced, groups })` → `{ allowed: boolean, reason:
string | null }`, applying duplicate → context → evidence in today's
exact order (split stays inline in the handler: persistence is not a
decision). Server ask handler becomes a thin caller; provider reads stay
handler-side (I/O) with counts passed in.

Tests `tests/ask-gate.test.mjs`: matrix proving order (duplicate +
context-violation yields the duplicate reason; context + evidence
violation yields the context reason), force bypasses context/evidence
but never duplicate, split tag routes around context/evidence as today,
non-build kinds and non-gate stages pass through. Wire as `test:ask-gate`.

No behavior change, no schema change, no CLI change. Acceptance:
existing ask/gate tests untouched and green.

## 3. Phase 2 — Optional declaration + storage (implemented)

- `--contract <id>` on `bb stelow ask` is parsed in
  `lib/question-batch.mjs` per group (alongside `--question`/`--option`).
- Validation at ask time against `requiredForStage` for the card's
  stage/mode/appetite: unknown id with a readable checklist refuses,
  naming the valid ids; without a readable checklist it allows and
  records raw (fail-open). Unknown modes fail open as today.
- Storage: new `ask_contracts(interaction_id TEXT PRIMARY KEY, card_id,
  contract_id, asked_at)` rows written when the host interaction id is
  known at ask time; inbox matching later joins via the deterministic
  `questionInboxDedupeKey(cardId, interactionId)` (no inbox schema
  change). Undeclared asks store nothing and keep today's semantics.
- Parallel upstream PR (blocking for standalone parity, NOT for plugin
  use): document `--contract` in `ask.md` and accept it in the vendored
  `data/stelow` parser. Never hand-edit `data/stelow`; the plugin parser
  is authoritative for card workers.
- Acceptance: declaration round-trips ask→storage→advance-query in
  tests with a stubbed interaction id; undeclared flows byte-identical.

## 4. Phase 3 — Exact-id enforcement (intentionally deferred)

If real usage justifies it, `advanceCard` plus CLI advance would consult
recorded ids: a human-ask contract is
satisfied by an answer carrying its id since stage entry. Fallback (kept
deliberately): undeclared answers satisfy generally, exactly as today —
otherwise ad-hoc clarifying questions would break. Unknown ids recorded
raw never satisfy. Observe real data one release before considering
requiring declaration at contract stages.

## 5. Verification bar (all phases)

`npm run typecheck` + full `npm test` + `npm run lint` (no new
warnings) + `git diff --check`; English copy; commits separated
(`feat:`/`fix:` bump releases); `skills/` untouched.

## 6. Risks / non-goals

- No enforcement without a readable checklist (fail-open preserved).
- No UI widgets; no changes to answer RPC shapes.
- Unknown review modes/appetites fail open throughout.
- The dispatcher must not absorb split persistence or provider reads.
