# Release runbook

Procedures for cutting, merging, and recovering releases. The discipline
lives in `AGENTS.md` (`## Releases`); this file holds the mechanisms and
recoveries. Read it when cutting, merging, or recovering a release.

## Batching types

A `fix:` on top of a `feat:` still bumps minor while both are pending,
because release-please takes the highest type in the accumulated set —
which is the second reason to let it accumulate rather than shipping the
patch first and the feature after it.

## Reviewing the release PR

Never merge the release PR unreviewed. Curate the generated notes in
the PR first when the Keep-a-Changelog prose needs a human touch, and
confirm CI is green on it. Keep feature commits separate; the release
PR owns the version bump.

## CHANGELOG discipline

**Curate `CHANGELOG.md` on the release branch, never the release PR
body.** Release-please parses its own release PR body to recognise
that PR as its own. Rewrite that body and it can no longer parse it
(`could not parse pull request body as a release PR`), stops seeing
its own release PR as merged, and never publishes the tag. The prose
belongs in the `CHANGELOG.md` section on the
release branch, which release-please regenerates only when new commits
arrive, so it survives until the merge. A body edit surviving later
runs is a different question from whether release-please can still
read it, and after such an edit it cannot.

## The published check

`scripts/check-release-published.mjs` fails the release run when
master carries a version that has no tag and no open release PR for
it. Run it after any manual tag or release change; the workflow runs
the same check.

## Stalled verify

**A release PR's `verify` can sit in `action_required` with zero
jobs.** It is a
platform-level approval gate on `pull_request` events, not a test
failure: the run never starts, so there is nothing to read in the log.
Approve it and it proceeds:

```bash
gh api -X POST repos/calionauta/bb-plugin-stelow/actions/runs/<run-id>/approve
```

Do not re-run it instead, and do not merge around it: a check that
never executed is not a passing check, and merging the release PR on
one leaves the version bump unverified.

## Silent squash merges

**Squash-merging a release PR sometimes triggers no workflow at all.**
Both `ci` and `release` fire on every other push to `master`, but a
release PR merged by squash has produced zero runs — twice, on v0.57.0
and v0.57.3, while every neighbouring push ran normally. "The merge is
the release" assumes the merge starts something, and here it does not.
Wait five minutes; if the merge commit has no run, the merge was not
the release:

```bash
gh workflow run release.yml
```

The version-coherence guard cannot cover this, and that is worth
saying plainly: it runs *inside* the release workflow, so a workflow
that never starts never reaches it. Recover, then check the tag
exists — `gh release list --limit 1`.

## How a squash is typed

**A squash-merged PR is typed by its branch commits, not by its title.**
This repo sets `squash_merge_commit_title = COMMIT_OR_PR_TITLE` with
`squash_merge_commit_message = COMMIT_MESSAGES`, so a multi-commit
branch is squashed under the **last commit's** subject and the
individual messages survive in the body. The subject — the only line
release-please reads for the change type — therefore comes from a
commit, and the title never types the release.

## Fixing a wrong bump

When a bump is already wrong — the release PR is open and says the wrong version —
correct it through the release workflow's own `release-as` input
(`gh workflow run release.yml -f release-as=<version>`), never by
editing `package.json` in the release PR, which release-please
overwrites. A `BREAKING CHANGE:` footer on a 0.x line computes 1.0.0
and that milestone is refused by `check-release-major-claim.mjs`,
which points back at `release-as`; `bump-minor-pre-major` cannot
soften it, because passing `release-type` on the action makes
release-please ignore `release-please-config.json` entirely.

## Verifying a landing

**A squash merge destroys the evidence you would use to check the
work landed, so verify by content, not by commit message.** After a
squash, `git log --grep="<commit subject>"` finds the *PR title* and
tells you nothing about whether the individual fixes are present —
several unrelated `fix:` subjects collapse into one line. To confirm
work reached `master`, read the files (`git show master:<path>`, the
`gh api repos/.../contents/<path>?ref=<tag>` shape for a release, or
`git show --stat <merge>`) and look for the behaviour. This is the
only check that distinguishes "the commit is there" from "the change
is there", and a batch of unrelated fixes under one title is exactly
where the difference hides.

## What ships in the notes

Release notes come from commit messages: `feat:`/`fix:` (plus `perf:`
and `BREAKING CHANGE:`) bump the version and appear in the notes;
`test:`/`chore:`/`docs:` do neither. A feature committed without its
prefix ships in no release — message discipline is the release
process. Keep Settings → General → Automatically delete head branches
on so merged PRs don't accumulate stale branches.

## Frozen 0.3 migration line

The 0.3 preview line is frozen forever. Tags `v0.3.80`–`v0.3.88` are
one-shot migration releases — never move, delete, or retag them (bb refuses
a moved tag as a security failure, and `v0.3.80` is the recorded resolved
tag of 0.3-era installs). They are the one exception to the tag-release
rule above: master goes through release-please; the frozen line is tagged
directly and never merged to master.

0.3-era installs update to `v0.3.88` (their recorded `^0.3.14` range allows
it), then the in-app modal archives stale `.stelow` state and reinstalls
the current line from the repository (`git:…@>=0.23.0`). The line needs no
maintenance beyond these tags.

Keep the marketplace entry range honest with the current line (`>=0.23.0`
style). Never widen a recorded range retroactively — installed plugins
track their recorded range, not the listing.
