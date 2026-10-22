# Release incident narratives

War stories behind the rules in `AGENTS.md` (`## Releases`). Moved out
verbatim so the section states rules while the evidence stays one link
away — never the reverse. Each story names the rule it evidences;
`AGENTS.md` remains the only source of the rules themselves.

## A day of UI work is one minor release

This section described the mechanism for a long time and said nothing about cadence,
which is how one session shipped six releases in a day — v0.74.0 through
v0.78.1, each technically correct and each a version every install has
to move through. The mechanism was never the problem; merging on sight
was.

(Rule: the release PR accumulates; merge it when you want to cut, not when it first appears.)

## The hand-edited release PR body (v0.57.0)

On v0.57.0 that is exactly what happened: the body was hand-edited to restore a
feature entry release-please had dropped, and the release silently
never shipped.

(Rule: curate `CHANGELOG.md` on the release branch, never the release PR body.)

## `verify` stuck in `action_required`

Observed four times, always on the release-please branch and
always intermittent — the same branch also passed cleanly.

(Rule: approve the run; never merge around a check that never executed.)

## Squash subjects that mistyped releases

This is not hypothetical: PR #211 carried a `feat:` commit and a `fix:` commit
under a `feat:` title, and master recorded the `fix:`, shipping a
feature as a patch. PR #157 mixed the design-ref feature with three
fixes and a sync, and release-please computed 0.56.5 for work that
had to ship as 0.57.0.

Observed the other way on #361: a 15-commit branch merged with the PR
title (`Bb/fix question copy realtime`) as the squash subject, carrying
no conventional type at all — release-please saw nothing to release and
no release PR opened, which is how a whole batch ships silently.

(Rule: name the PR title for the highest change type the branch carries;
the last commit on a branch that carries a feature is `feat:`.)
