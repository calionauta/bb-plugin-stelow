# RFC: simpler, sturdier worker execution

Status: draft. Context: two production incidents on one card (a worker
`seed`ing an ownerless project-root workflow; a worker idling after every
stage) forced host-side guards in v0.4.9–v0.4.11. Those guards work, but
they defend a core that is still prompt-obedience all the way down. This
RFC records the remaining fragilities and the smaller architecture that
would remove whole bug classes instead of guarding them.

## What v0.4.9–v0.4.11 already fixed

- `bb stelow seed` refuses card workers with the card's own state dir as
  the redirect (`lib/card-seed-guard.mjs`).
- The host auto-continues idle workers with fresh text output or a
  completed `advance` in the finished turn, budget-gated per stage, never
  past pending questions or `audit` (`lib/auto-continue.mjs`).
- Seed ban + turn discipline are single-source consts referenced by all
  three build spawn paths, pinned by `tests/prompt-contracts.test.mjs`.

## Remaining fragilities (ranked)

1. **Correctness rests on LLM obedience.** Stage order, gates, intent
   recording, artifact shapes — all enforced by prose in spawn prompts +
   27 vendored skills. Every new spawn path that forgets a clause ships a
   weaker worker (this already happened once: the band-swap restart
   prompt). The prompt-contract test covers two clauses; the input
   contract, gate discipline, and stop conditions are still unpinned
   prose.
2. **No explicit completion.** Done-ness is inferred from
   `current_stage == audit` + idle. A worker that narrates-and-stops at
   `audit` is indistinguishable from one stuck at `audit`; a worker that
   never reaches `audit` has no way to say "finished". The idle/complete
   ambiguity is the same confusion that produced the original incident.
3. **State is markdown parsed by regex** (`current_stage`, `intent`,
   `appetite` read via regex in `syncThreadState`, board listing).
   A worker that reformats state.md breaks the board silently; nothing
   validates the file on write.
4. **Three sources of truth.** `state.md` (worker) + `stelow.json` index
   (host) + `cards` DB (board) + thread events (provider). Every feature
   pays a sync tax (`syncThreadState`, 45s reconcile sweep, skill sync,
   scope sync), and every sync is a drift opportunity.
5. **Identity by indirection.** Workflows resolve through
   `(owner → dirHash → created-date → path)` plus an index file. The
   orphan seed was this machinery's natural failure mode. A fixed path
   per card would make twins unrepresentable.
6. **Shell-based skill discovery.** Skill ids are content hashes, so
   workers find playbooks via `bb skill list | awk …` pipelines — flaky
   (leakguard blocks, `show <name>` fails) and wasteful (observed: whole
   turns burned on discovery). The host knows the exact paths; it should
   tell instead of letting the worker search.
7. **14 CLI subcommands, one flat namespace.** The worker must learn
   `status/ask/seed/advance/doctor/schema/sync-scopes/lock/config/
   preview/fan-out/verify/preset` and which resolve card context (only
   some do). Each new verb is a new way to act outside the card.
8. **Polling loop.** 45s reconcile × per-card `threads.get` + `output` +
   `files.read` + `interactions.list`. Slow feedback (stalls page after
   ~90s+), O(cards) host load, and edge logic (`transitioningIntoIdle`)
   re-derived from snapshots instead of events.
9. **No turn lease.** Two resumes (human double-click, auto + manual
   racing) start two turns. No dedupe, no mutex.
10. **Triplicated lifecycle.** Build/research/explore each own a sync
    function, idle branch, and prompt family with slightly different
    rules. Shared copy exists (`buildContinueNudge`, `CARD_OWNER_RULES`)
    but each kind still re-states its contract inline.
11. **Band-swap respawn by timer.** `advance` → `setTimeout(10ms)` →
    archive old thread + spawn new one mid-workflow. Handoff is a prompt
    paragraph; context compacts to whatever state.md holds.

## Proposed architecture (convention over configuration, DRY)

A. **One fixed state path per card.**
   `<workspace>/.stelow/cards/<cardId>/state.md`. Delete `dirHash`,
   `created` pinning, and the index upsert path for card workflows
   (keep name-derived owners for cardless/human flows only). Seed
   becomes "ensure the file exists" — idempotent by construction, and
   the refusal guard stays as defense in depth. Migration: one pass
   moves existing `pw-*` dirs to the fixed path and drops the columns.

B. **Explicit completion: `bb stelow done`.**
   The worker declares done; the host marks completed. Idle + not-done
   + progress → resume; idle + done → complete; idle + silent → paused.
   Removes the audit-idle inference and gives research/explore the same
   crisp terminal they lack (their "STOP and end your turn" becomes a
   command instead of a wish).

C. **Four worker verbs; host resolves context always.**
   `status`, `advance`, `ask`, `done` (+ `verify` as a preflight).
   Everything else (`seed`, `sync-scopes`, `lock`, `config`, `schema`,
   `fan-out`, `preset`, `preview`) becomes host/UI-only and refuses
   card threads with a redirect, exactly like seed does today. The
   worker's decision surface shrinks from 14 verbs to 5.

D. **The host serves playbooks; workers never discover.**
   `bb stelow playbook` prints the exact ordered reading list for the
   card's current stage (paths, not skill ids). Kills the
   `skill list | awk` pipelines and the hash-id flakiness in one move.
   Longer term: inject the current stage's playbook into the turn
   context server-side so there is nothing to load at all.

E. **Validate state.md on write.**
   `advance` (and `done`) validate the whole file against the schema
   (`stelow.schema.json` already exists): unknown stage → refuse;
   missing keys → refuse with the fix. A worker that reformats state.md
   gets a loud, actionable error on its next command instead of a
   silently broken board.

F. **Events first, sweep as backstop.**
   Drive sync off `thread.idle/active/failed` (already subscribed);
   keep the sweep at a slower cadence for missed transitions only, and
   batch one read per card per cycle. Cuts stall-to-page latency and
   host load together.

G. **One parameterized lifecycle.**
   Single `syncCardThreadState(card)` with kind-specific policy as data
   (`lib/tracks.mjs` owns the table), not three functions. Same for the
   prompt skeleton: one builder, kind-specific sections as data, every
   clause a const covered by the prompt-contract test.

H. **Turn lease.**
   Record `last_resume_at` + the turn request id on every host-initiated
   send; ignore a second resume while the first hasn't produced a new
   turn. Kills double-turn races from UI double-clicks and auto/manual
   overlap.

## Suggested order

1. C + `done` (B): smallest structural win; makes auto-continue's rule
   crisp and gives every kind a real terminal.
2. A (fixed paths): removes the orphan class structurally; needs the
   one-pass migration.
3. D (playbook endpoint): deletes the flakiest worker behavior observed
   in production logs.
4. E (validation), F (events), G (unify), H (lease): reliability
   hardening once the model is smaller.

## Open questions

- `startWorkflow` (cardless spawn) is a parallel universe with no owner
  rules: keep, fence, or delete?
- Research/explore share the build machine's verbs but not its stages:
  does `done` suffice as their terminal, or do they keep prompt-based
  STOP?
- Who owns `stelow.json` after fixed paths — index of cardless flows
  only, or deleted entirely?
