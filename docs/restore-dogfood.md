# Dogfood — restore round trip against the live database

Run 2026-09-28, after `v0.56.4` (commit `52c86b5`). The restore feature landed
in `04faa63` and was never exercised against real data. This is that run, and
the numbers are the record.

## Why the named subject was rebuilt

The spec named `card_19ny9eq3` — a build card, archived, stage `triage`, one
unanswered question, a stored `last_error`. It does not exist. The live DB holds
**13 cards, 12 archived, 0 questions closed by an archive**. The population the
spec described ("19 archived cards hold an unanswered question and 15 of those
also carry a `last_error`") is gone, and the four most recent plugin snapshots
do not contain the card either, so it predates them.

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
| question (`archived`) | resolved | **open, reason cleared** | resolved `superseded` |
| question (`answered`) | resolved | **still resolved** | still resolved |
| error (`archived`) | resolved | **open, reason cleared** | resolved `archived` |
| control card | `archived`, error resolved | **unchanged** | unchanged |
| open events on fixture cards | 0 | 1 (the error) | **0** |

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

Terminality, the regression the feature was most likely to cause: dragging the
re-archived card to `in-progress` was **refused** by `moveCard`. Restore is not a
move target, and nothing automated carries the key.

## The one invariant that did not hold, and why

The question was reactivated correctly — restore's own UPDATE set
`resolved_at = NULL, resolved_reason = NULL`, which the AFTER row shows. Then
the **fresh worker superseded it**.

That is not a restore bug, and it is not a race. Restore deliberately stops the
old thread and starts a new one, because the old thread's history "is not a valid
continuation". A pending question belongs to the thread that asked it. The new
worker has no such interaction, so its question sync resolves it as
`superseded` — which is the truth: nobody is waiting on that question any more.

**The spec's invariants 2 and 3 are contradictory as written.** "A fresh worker,
never the old thread" and "the question is live and answerable" cannot both hold
for a question that was addressed to the old thread. The dogfood is what found
it; a unit test against a synthetic worker could not, because the question would
have stayed open for the length of the test.

The question worth deciding is whether a question should survive the worker that
asked it. If a card's pending question is meant to outlive its worker, the sync
rule needs to recognise a restored card's questions as still live. That is a
behaviour change, and it belongs in a card rather than in a bug fix — this run
records the finding and changes nothing.

## What this proves, and what it does not

It proves the feature works on real data: correct stage, fresh worker, per-kind
reactivation, the `answered` case untouched, the error verbatim, no collateral
damage, no leftover state, and terminality intact.

It does not prove the question case, because that case cannot hold as specified.
Restoring a card whose question belongs to a dead thread is a real scenario
someone will hit, and it is still open.

## Cost

Two worker spawns on fixture cards with a do-nothing prompt. The fixture cards
were removed afterwards; the database is otherwise untouched.
