# Audit records

Dated audit and evaluation records, kept next to the code they judge.

**This whole directory is meant to be deletable.** When a record stops being
true, remove it in one step — there is nothing else in the repository that
depends on it:

```console
rm -rf docs/audits
```

Then delete the single line pointing here from `docs/README.md`. The `runs/`
directory is different: it is execution evidence and stays.

## Naming

`YYYY-MM-DD-<subject>.md`, where the date is the day the audit **ran**, not the
day it was filed. Type is carried by the subject (`-audit`, `-evaluation`) and
restated in the file's own header, so a record is identifiable from a filename
alone.

## Records

- `2026-10-23-stelow-audit.md` — two parts in one file: **Part I** is the
  seven-auditor audit of plugin + upstream; **Part II** is the answer it
  prompted, on whether that upstream/plugin split is itself among the causes.
  Its findings are the evidence base for everything else here.
- `2026-10-23-premise-recheck.md` — what survived the plan against `origin/master`:
  0 of 43 acceptance criteria, and three scopes whose central finding was
  branch-local. Read this before executing anything from the plan.
- `2026-10-23-stelow-audit-repair-plan.md` — the plan derived from it: eight
  typed scopes, sequenced by the Stelow planning rules, each with observable
  acceptance criteria, a test map, NFRs and a scope contract; plus the
  execution protocol (baseline, red proof, freeze, verify, record, PR).
- `2026-10-23-scope-3-record.md` — state honesty, reconstructed after the fact
  from the three commits of `fix/state-honesty-2026-10-23`. Names the red proofs
  re-run on the merged tree, and the two acceptance criteria the plan mapped to
  tests that do not assert them.
- `2026-10-23-contrast-wiring-record.md` — how the contrast matrix became a card
  artifact, how a question records the cell or artifact line it came from, and
  how a rewind invalidates an answer by that premise. Includes what still needs a
  live card to prove.
- `2026-10-23-one-owner-record.md` — two facts that had several owners: the gap
  registry the skill documented and the parser refused, and the artifact count
  whose commit trailer was derived from the copied subset. Names the owner kept
  for each, the test that holds it single, and the red proofs.

Part I of the audit is a translation of its source, so it keeps the source's
structure — findings, tables, numbering — and a reader can check it against
thread `thr_8ahzqb3cye`, which the header names. Both files are written in
English like the rest of `docs/` (`AGENTS.md`), and their tables are exempt from
the 160-column source rule for the obvious reason: a markdown table row cannot
be wrapped.

## What belongs here, and what does not

- **Belongs:** a dated, evidence-bearing judgment about the code — an audit, a
  review verdict, a measured evaluation, a decision record.
- **Does not belong:** behaviour. A record describes what was true on its date;
  the authority for what the code does is the gate or the test that enforces
  it. A record that starts quoting current numbers instead of pointing at the
  gate becomes a second source of truth, and drifts by nature — that is the
  failure `remaining-debt-audit.md` already documented at 1,967 lines.
- **Does not belong:** anything that must survive a `rm -rf docs/audits`. If a
  finding needs to outlive its record, its fix belongs in a test, not in prose.
