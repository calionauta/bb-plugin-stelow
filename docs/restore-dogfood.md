# Dogfood — restore round trip against the live database

Run 2026-09-28, after `v0.56.4` (commit `52c86b5`). The restore feature landed
in `04faa63` and was never exercised against real data. This is that run, and
the numbers are the record.

## Why the named subject was rebuilt

The spec named `card_19ny9eq3` — a build card, archived, stage `triage`, one
unanswered question, a stored `last_error`. It does not exist. The live DB holds
**13 cards, 12 archived, 0 questions closed by an archive**. The population the
spec described ("19 archived cards hold an unanswered question and 15 of those
also carry a `last_error`") is gone.

**The deletion is unexplained, and the reason is not age.** An earlier draft of
this file concluded from the four most recent plugin snapshots also lacking the
card that it predated them. That is backwards, and it matters: the snapshots run
2026-09-22 → 09-23, while a `.backup` of the same database taken at 19:19 on
2026-09-28 holds all 66 cards **including `card_19ny9eq3`**. So the card was
created after the snapshots and deleted after 19:19, not before the snapshots.
53 of 65 archived cards are gone and the 12 survivors are scattered across
2026-09-05 → 09-24, so a date filter does not describe it either. `recovery_audits`
is empty and deletion is a hard delete, so the data carries no author. What is
*not* ruled out is this repo: the run behind this document used the real
`restoreCard` and `moveCard` RPCs against the live database, and its cleanup of
the two fixture cards is the one write path in it that the read-only fixture
`tests/fixtures/restore-dogfood.mjs` cannot vouch for. Treat the cause as open
until someone confirms whether the deletion was intended.

So the fixture was rebuilt to the same profile rather than substituted with
whatever survived. `card_dogfood_restore` is a build card, archived, stage
`triage`, one question and one error each closed with `reason = 'archived'`,
plus a stored `last_error`. A **control** card carries its own archived error,
and a second question is closed with `reason = 'answered'` — the case a blanket
restore would wrongly reopen.

## Numbers

| | before | after restore | after re-archive |
|---|---|---|---|
| card status | `archived` | `draft` | `archived` |
| card stage | `triage` | `triage` | `triage` |
| worker thread | none | **one** | one (in history) |
| question (`archived`) | resolved | **still resolved** (withheld) | resolved `archived` |
| question (`answered`) | resolved | **still resolved** | still resolved |
| error (`archived`) | resolved | **open, reason cleared** | resolved `archived` |
| control card | `archived`, error resolved | **unchanged** | unchanged |
| open events on fixture cards | 0 | 1 (the error) | **0** |

The question rows read as they do NOW. When this run first happened, restore
reopened the archived question and the fresh worker superseded it a second
later; the row then read "open, reason cleared" and "resolved `superseded`".
That finding is decided — a question does not outlive the worker that asked it
— and restore now withholds it and counts it as `questionsWithheld`. The
"after restore" column above is the behaviour as it stands, and the reason is
in the section below.

Restore and re-archive both ran through the real RPCs — `restoreCard`, then
`moveCard` — not through SQL.

## Invariants, in the order the spec asked for them

1. **Returns to stage `triage`, not a phase entry.** Held. Status derived to
   `draft`, which is the documented rule for `triage`; the stage was never
   touched.
2. **A fresh worker starts.** Held. `worker_thread_id` went from null to set;
   the card log records *"Worker started on preset Default, continuing from the
   triage stage."*
3. **The question is live and answerable.** **It did not stay live** — see below.
4. **The error is back with the original reason.** Held. `resolved_at` NULL,
   `resolved_reason` NULL, and the summary is the card's stored `last_error`
   verbatim.
5. **Nothing else moved.** Held. The control card is byte-identical, the
   `answered` question stayed resolved, and the fixture leaves **zero** open
   events when re-archived.

### Terminality, re-tested properly

The first attempt at this check dragged the re-archived card to `in-progress`.
It came back `rpc input validation failed` — and that proved nothing. `in-progress`
is not a board column at all; zod rejected it at the schema, one layer before the
terminality guard could run. Reading that refusal as terminality holding would
have been the exact failure this file exists to prevent: an error that agrees with
the assertion for the wrong reason.

Re-tested with real columns, on one card of each kind, because `resolveCardMove`
routes build and lightweight tracks through different branches — a phase target
for build, a status target for research:

| card kind | target column | result |
|---|---|---|
| build, archived | `analysis` (phase) | refused — *This card is archived.* |
| build, archived | `execution` (phase) | refused — *This card is archived.* |
| research, archived | `doing` (status) | refused — *This card is archived.* |
| research, archived | `done` (status) | refused — *This card is archived.* |
| build, archived | `archived` (no-op) | **accepted** |

Both cards were byte-identical afterwards. The guard is in front of the
`resolveCardMove` call, not inside it, so it holds for every track without each
track remembering it — which is the right place, and the reason a fourth column
would have been covered too.

The no-op row is the guard's other half and it matters: a person nudging an
archived card a few pixels and releasing it where it already sat must not be told
the card is archived, for a move that changes nothing.

**And the refusal names no exit.** *This card is archived.* is the whole message.
The blueprint's own rule is that every refusal names the valid way forward, and
this one does not — a deadlock with a good error message, which is the failure
mode the other half of this feature exists to prevent. The door exists (Restore,
under the card's manage menu); the refusal just does not point at it. Left
unfixed here, and reported instead: the string is duplicated across seven
call sites, so naming the exit means changing one source and seven literals, and
that is a change to messages a dozen tests assert on.

## The invariant that did not hold, and what was decided about it

The question was reactivated correctly — restore's own UPDATE set
`resolved_at = NULL, resolved_reason = NULL`, which the original run's AFTER row
showed. Then the **fresh worker superseded it**.

That was not a restore bug, and not a race. Restore deliberately stops the old
thread and starts a new one, because the old thread's history "is not a valid
continuation". A pending question belongs to the thread that asked it. The new
worker has no such interaction, so its question sync resolves it as
`superseded` — which is the truth: nobody is waiting on that question any more.

**The spec's invariants 2 and 3 were contradictory as written.** "A fresh worker,
never the old thread" and "the question is live and answerable" cannot both hold
for a question that was addressed to the old thread. The dogfood is what found
it; a unit test against a synthetic worker could not, because the question would
have stayed open for the length of the test.

**The decision: a question does not outlive the worker that asked it.** Tracked
as [#178](https://github.com/calionauta/bb-plugin-stelow/issues/178), which
laid out the trade-off — keeping the question live needs a second identity on
the row (the asking thread) plus an exemption from the sync, on the path where
`superseded` exists precisely to stop the badge lying about a dead thread.
That trades one lie for another and buys it for a rare case, so restore now
withholds the question and counts it (`questionsWithheld`) instead, trailing
the count with the exit: the worker re-asks anything it still needs.

This narrows the "never a partial restore" rule on purpose, and that narrowing
is named in `FEATURES.md` and in `lib/card-restore-pending.mjs` so the next
reader sees it was chosen rather than inherited.

## What this proves, and what it does not

It proves the feature works on real data: correct stage, fresh worker, per-kind
reactivation, the `answered` case untouched, the error verbatim, no collateral
damage, no leftover state, and terminality intact.

It does NOT prove the withhold decision at the host level: the run that
collected this evidence pre-dates it, and the withhold itself is a pure
per-kind rule exercised against a real SQLite database in
`tests/card-restore-pending.test.mjs`. What a real host would still need to
confirm is that the withheld count reaches the trail comment, which
`tests/runtime-card-restore.test.mjs` covers with fakes. The scenario — a
restored card whose question belonged to a dead thread — is now decided rather
than open.

## Cost

Two worker spawns on fixture cards with a do-nothing prompt. The fixture cards
were removed afterwards; the database is otherwise untouched.
