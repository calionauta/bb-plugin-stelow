# Team playbook (experimental)

One bb per teammate. GitHub as the team room.

bb is single-user: one board, one inbox, no shared state across
machines. So the team does not meet inside the plugin — it meets
in the GitHub repository, and each member runs their own bb +
Stelow. This document is the operating proposal, not a guaranteed
process. Try it, break it, report back in the plugin repo issues.

## Roles

- **Owner (one per repo).** Labels every issue — risk tier,
  specialty, assignee. Keeps the labels honest as work evolves.
  Without an owner, labels rot and gates lose their teeth.
- **Operator (one per issue).** Imports the assigned issue into
  their own bb, runs the card, answers questions, carries the
  work to Done. The assignee on the issue.
- **Specialist (shared across teams).** Owns verdicts at the
  gates the issue names — product, design, tech, or all. A
  specialist may support several teams; involvement is keyed to
  risk, not to team membership.

## Label schema

Three label axes on every tracked issue:

1. **Risk tier** — `risk:go-alone`, `risk:consult`, or
   `risk:approve`. Set by the owner at triage.
2. **Specialty** — `needs:product`, `needs:design`,
   `needs:tech` (combine freely). Names whose verdict matters.
3. **Assignee** — the operator. GitHub assignees; the plugin's
   GitHub dialog filters by them.

Tiers:

- 🟢 **Go alone.** Low risk — the operator takes it and owns
  the outcome. No specialist involved.
- 🟡 **Consult.** Medium risk — the owner marks which gates
  pause for advice (e.g. product gate, interface gate). At each
  marked gate the operator consults the named specialist for
  knowledge and experience, then advances. Advice in, decision
  stays with the operator.
- 🔴 **Approve.** High risk — the owner marks which gates need
  a sign-off. At each marked gate the specialist of that stage
  owns the verdict, filed as a receipt. The operator cannot
  advance alone.

Default gate → specialist mapping (override per issue):

| Gate | Specialist |
|---|---|
| Product gate (spec) | product |
| Interface / int-gate | design |
| Tech plan gate | tech lead |
| Diff gate | tech lead |

## Flow

1. **Propose.** Anyone opens an issue with outcome, IN/OUT
   sketch, and suggested planning depth. The owner labels it
   (tier, specialty, assignee). Nothing starts without an owner
   and an assignee.
2. **Own.** The operator imports the issue (GitHub dialog,
   manual or auto-import rule on the watched labels) into their
   own bb. Auto-start rules need an isolated worktree
   destination; cards sharing one checkout coordinate through
   the file-claim registry instead of colliding.
3. **Gate.** At each marked gate the operator stops: consult
   (🟡) or request approval (🔴). Specialists review the
   artifact — spec, interface, plan — in the artifact viewer or
   on disk, never the token stream, and leave the verdict as a
   comment on the issue. The operator files it by approving the
   gate, which writes the receipt under `.stelow/approvals/`.
4. **Merge.** `bb stelow export` refreshes `docs/runs/<card>/`,
   the `Stelow-Artifacts:` trailer goes in the commit, and the
   completion writes back to the issue (`postGithubCompletion`).
   Done is traceable from the issue to the commit to the bundle.
   Note the trust boundary: gate receipts record that the
   operator approved the gate in their own bb — they do not
   prove who authorized it outside. Specialist verdicts arrive
   as issue comments; the operator files them by approving.

## Rituals

- **Weekly gate review.** Open marked gates are the agenda;
   stelow artifacts are the pre-read. Receipts are the minutes.
- **Label hygiene.** The owner re-tiers issues whose risk
   changed. Stale labels are the commonest failure mode of this
   playbook.

## Limits (honest scope)

- No shared board, no shared inbox, no cross-member assignment
  inside bb. All coordination runs through GitHub.
- Specialists review asynchronously; nothing in the plugin
  notifies them — @-mention them on the issue.
- Automation rules never move cards, merge code, or import
  behind anyone's back (see `docs/github-issues.md`).
