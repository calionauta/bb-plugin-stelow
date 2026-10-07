# Plugin development

## Gates before a commit

`npm test` and CI run the whole gate set; two of them are cheap enough to run
before the commit exists, and both are wired as a git hook:

```sh
git config core.hooksPath scripts/git-hooks   # once per clone
```

- `lint` (oxlint) — dead code, unused imports.
- `quality:shape` — a function, a file or a line over its budget.

`typecheck` (~35s) and `npm test` (~3min) stay in CI: a gate nobody waits for is
a gate that gets `--no-verify`. Run them yourself before a push, and do not
reach for `--no-verify` to skip the two that are fast — the failures they catch
are the ones that come back as a red CI five minutes later.

## Commands

- `npm run build:reload` — after every change and after each `package.json#version` bump: builds the bundle and reloads the plugin in the running BB; use `npm run reload` when the UI still looks stale (do not rely on `npm run build` hot-reload alone).
- `npm run typecheck` — must be green before committing.
- `npm test` — full suite; must be green.
- `node scripts/sync-stelow-assets.mjs` — manual skill/data sync (pinned commit; then `npm run reload`).
- `grep dist/` — confirm the bundle actually contains the change; the reload
  version string is unreliable. Grep for a distinctive *string the change
  itself emits*, not a filename or symbol: a filename is present whether or
  not the new logic reached it. For synced content, grep the shipped
  `dist/skills/<file>` — the only proof the upstream change reached users,
  since a `skills/` diff in git proves only that someone committed it.

## Edit discipline (agent tooling traps)

- One `edit` per file per parallel block — parallel edits to the same file silently clobber each other; sequence them instead.
- After any failed `edit`, verify the file before continuing (`wc -l` + `git diff --stat`): a failed match has truncated files before.
- Never `read`-then-`edit` from memory on large regions — reproduce `oldString` from a fresh `read`, or the match silently targets the wrong text.
- Before writing or updating a test pin, `grep -c` the pattern first: generic shapes match other tracks (research/explore submits share the build shape). Anchor pins on track-specific identifiers (RPC names), and declare test-file reads before their first use.

## Source shape: LoC is a safety limit, never a formatting target

- A file at 400 lines or a function at 50 lines is a red flag, not a quota to hit by compressing code.
- Never satisfy a LoC budget with minified JSX, chained expressions, semicolon-packed declarations, or intentionally long single-line JSX. Split behavior, markup, and data instead.
- Keep JSX readable: one element/branch per line, attributes grouped across lines when needed, and extracted components for repeated or conditional blocks.
- Treat a changed source line over 160 characters as a review failure unless it is an unavoidable URL, generated artifact, or machine-readable fixture. Do not hide JSX or logic in long template strings.
- LoC checks must measure readable source, not reward line-count gaming. New extraction slices must pass the repository shape checks before review; inherited legacy violations are reported separately, not copied into new files.

## Don'ts

- Never restart `bb-daemon.service` to reload this plugin — it terminates active BB threads.
- Never assume the checkout is still yours: this repo is shared between
  threads, and another one can change the checked-out branch or leave commits
  on it while you work. Re-read `git branch --show-current` and `git status`
  immediately before every commit, push, and rebase. The failure is silent —
  a commit meant for your branch lands on theirs, and a rebase rewrites work
  that was never yours.
- Commits you find already on `master` (or any shared ref) belong to another
  thread. They are not yours to push, tag, or release: open a branch from
  `origin/master`, rebase them onto it, and PR them. Finding work
  committed-but-unpushed is not permission to publish it.
- Never `git reset` (with or without `--hard`) to "realign" a checkout another
  thread may be using: reset moves the branch pointer and leaves the working
  tree describing the *old* commit, so the next build silently runs stale code
  and the next `git status` shows a `package.json`/`CHANGELOG.md` nobody
  edited. Realign with `git pull --ff-only` on the branch you actually want,
  or a fresh worktree.
- Never `git push --force` to `master` to undo a bad push;
  `--force-with-lease` on a ref you pushed yourself is the only force allowed
  here, and only to restore a commit you just published.
- Never stop threads or delete data in `bb.onDispose` — it fires on every hot-reload, not just uninstall; killing workers massacres in-flight work.
- Never hand-edit `skills/` or `data/stelow` — both sync from upstream and are overwritten without warning; fix upstream and let the sync propagate.
- Never tag or `gh release create` from a laptop — on master the merged release PR is the release (release-please); the frozen 0.3 line (`v0.3.80`–`v0.3.88`) is the only exception (direct tags, never merged).
- Never merge the release PR unreviewed; never widen a recorded marketplace range retroactively — installed plugins track their recorded range, not the listing.
- Never write non-English code, comments, docs, CHANGELOG, or UI copy; never ship a user-facing feature without its `FEATURES.md`/blueprint entry.

## Owned vs vendored code

- `skills/` is synced from `calionauta/stelow` and overwritten without
  warning. Never hand-edit it; fix methodology upstream and let the sync
  propagate (run it manually when urgent, then commit the result).
- `data/stelow` is a synced copy of upstream `scripts/stelow`
  (`syncHelperScript`, same sha discipline as skills). Never hand-edit it;
  port state-machine rules upstream and let the sync propagate.
- `lib/` + `tests/` are owned. New state-machine logic belongs in `lib/`
  with a node test, following `inbox-events` / `ask-cancel` precedent —
  never inline-only in `server.ts` handlers.

## Skills sync

- Run manual syncs only via `node scripts/sync-stelow-assets.mjs`
  (pinned commit, ledger in `data/`, atomic per-skill swap).
- After syncing a live checkout, run `npm run reload` so the server
  re-registers skill trees. A spawn landing on a just-swapped tree 404s
  until rescan — start-phase failures auto-retry (bounded), then inbox.

**An upstream tag does not trigger the sync — the workflow listens for
`repository_dispatch` (`stelow-release`), not for a release.** Tagging
upstream and declaring victory leaves the plugin pinned to the previous
commit with no error anywhere. After cutting an upstream release, either
dispatch it yourself or watch for the bot and do not assume:

```bash
gh api -X POST repos/calionauta/bb-plugin-stelow/dispatches \
  -f event_type=stelow-release -F 'client_payload[commit]=<tag-or-ref>'
```

Then confirm the pin actually moved (`data/stelow-source.json` on
`master`) before calling the two repos consistent.

**Sync-owned content that disagrees with upstream is a bug in the
plugin, and it is invisible until the next sync silently reverts it.**
The drift shows up as an uncommitted diff in `skills/`/`data/`, or as a
commit whose content matches nothing in the pinned ref — check with
`git show master:skills/<file>` against the upstream ref rather than
trusting the commit message. The fix is always upstream-first (fix
methodology in `calionauta/stelow`, cut a release, dispatch the sync);
committing the local edit makes the plugin disagree with its own pin
until the next bot run.

## Transitions are enforced in one place

Stage/mode rules live upstream (`scripts/stelow` `do_advance`, mirrored
in the vendored `transitions.md`). Every refusal must
name a valid redirect — a refusal without an exit is a deadlock with a
good error message. Verify all paths live with fixture `state.md` files
before shipping guard changes.

**A guard with no door is a trap, not a safety.** Terminality protects a card
from automation, not from a person. A settled poll, a stale event, or a drag
must never resurrect an archived card — and none of them may. But when someone
archives a card by accident, the only exit being an irreversible delete destroys
the rows, the comments, the history and the run files, and that has cost real
work before. So archiving is terminal **to every automated path**, and reversible
**by exactly one human-initiated action**, on purpose, behind a confirmation,
naming the stage it returns to.

The two halves are one rule, and separating them is the point:

- **Terminal by default.** No poll, event, error path or drag may move a card
  out of `archived`. Not one of them carries the key. A drag is the most
  accidental gesture in the UI, and it must never be a resurrection.
- **Reversible by decision.** Restore is a separate named action, never a
  transition target — widening it into the general move path is the specific
  regression to fear, because it hands the blast radius back to a gesture
  instead of a decision. It is not an undo: delete stays irreversible, because
  restoring an archive is not restoring run files.
- **Never a partial restore.** An archive is the single event that closed every
  pending item on a card, so a restore that returned only some of them teaches
  the reader that the badge lies. Everything it closed returns; what it did not
  close — a question answered before the archive, an error that had already
  been resumed — stays closed, because the archive never took it away.
- **The stage survives.** Returning means returning to the exact stage, not to
  the phase's entry stage. Re-entering a phase would overwrite the card's real
  position with a guess about where the phase begins.
- **A refused spawn is a rollback, not a partial success.** A card must never
  be left claiming live work with no worker behind it; a phantom wait is a bug.

A refusal that names no exit is a deadlock with a good error message. So is a
terminal state with no way back that a person chose by accident.

## Commits

Write conventional commits: `type: subject` in English, imperative,
no scope unless it disambiguates. Only `feat`, `fix`, `perf`, and
`BREAKING CHANGE:` footers bump the version and appear in release
notes — `test`, `chore`, `docs`, `refactor` never do. A user-facing
change committed under the wrong type ships in no release.

## Feature inventory

`FEATURES.md` lists every user-facing feature grouped by job-to-be-done.
Any commit that adds, changes, or removes a user-facing feature must
update `FEATURES.md` in the same commit — a feature without an entry
does not exist. The same commit must update the PROSE that describes
behaviour it changes, and so must any `docs/` file that documents the
old behaviour: a documented example of an output the code no longer
produces is a second source of truth, and it is read by the next
person who goes looking for why a number is smaller than they expect.
`FEATURES.md` carries quoted outputs (measured values, recorded return
shapes) as evidence, so it drifts the moment a return shape changes. Deep operator/maintainer guides live in `docs/`
(e.g. `docs/github-issues.md`) and must be linked from README or
FEATURES — an unlinked doc does not exist either. The native Workflows
boundary and the decision-routing policy are documented in
`docs/native-workflows.md` and `docs/decision-routing.md`; consult them
before changing execution modes or adding model-backed decisions.

## Upstream blueprint

This plugin is the reference implementation behind upstream
`docs/host-plugin-blueprint.md` — abstracted lifecycle, inbox,
ask/answer, sync, and UI rules for building other hosts. Any commit
that adds or changes a user-facing pattern, lifecycle rule, or portable
`lib/` module must also propose the matching blueprint edit upstream
(separate commit in the stelow checkout): a pattern without a blueprint
entry does not exist outside this plugin.

## Code standards

Quality rules live in the coding-standards skill — never restated here.
Load `/skill:stelow-workflow-coding-standards` (KISS, DRY, convention over
configuration, plus LoB/SoC/Fail Fast/YAGNI with file/function size limits)
before writing or reviewing code. If the skill is not installed, install it
with `npx skills add calionauta/stelow@stelow-workflow-coding-standards`
(same standard, public source) and continue.

### UI vocabulary: a design rule with no test is not a rule

`AGENTS.md` has said *"touch targets are `min-h-11`; every clickable gets
`cursor-pointer`"* for a long time, and 84 raw `<button>` elements sat next to a
shared `ui/Button` that 62 files import while 26 never touch it. A sentence in
markdown does not intercept a commit. So UI rules here are enforced, and the
enforcement is what tells you the rule is real:

| Rule | Enforced by |
|------|-------------|
| A section is `SECTION_SURFACE` or `DisclosureSection`; what differs is its tone, never a new border | `card-surface-consistency` |
| A disclosure picks a named family: `DisclosureSection`, `SUMMARY_ROW`, `SUMMARY_LINK` — never a re-spelled `<summary>` | `card-design-tokens` |
| A shared name is imported, never redefined locally | `card-design-tokens` |
| A type size is a named step of `lib/design-tokens.ts`, or a declared exception with a reason | `card-design-tokens` |
| A section starts closed unless it is `live` or `blocking` | `card-surface-consistency` |
| Every fact on the card has exactly one home | `card-information-hierarchy` |

Adding a UI rule means adding its test in the same commit. If the test cannot
be written, the rule is a preference and belongs in review, not here. Known
debt that is deliberately not yet enforced is listed at the bottom of this
section rather than left to be discovered.

The reasoning behind each rule lives in the test file that enforces it, next
to the failure it produces — which is where a change will actually meet it, and
where it stays true when the test is renamed. Do not copy it into a second
document: a `DESIGN.md` was written here, found to be ~80% duplicated of those
docstrings, and deleted.

**Known debt, so it is not rediscovered as a surprise:** `text-[11px]` still
appears in 102 places doing the same job the scale already names — the size is
allowed, the test counts the sites against a ceiling that only ratchets down, and
the migration is owed but not urgent. The count is measured against
`components/` + `lib/`, which is why it reads 102 while a `components/`-only grep
finds 97: both numbers are right and only one is the one this sentence is about.
The
`min-h-11` rule above is the one this section is least able to keep: it is
stated, not tested, and 84 raw buttons are the standing evidence.

## Test value (no bullshit tests)

Every test must fail if its guarded behavior breaks — verify by removing or
inverting the behavior before trusting it green.

- **Behavior first:** logic that matters lives in `lib/` with a node test
  asserting outputs (`run-bundle`, `artifact-manifest` precedent).
  `server.ts`/`app.tsx` regex pins only for wiring that cannot be extracted.
- **Regex pins must constrain topology, counts, or refusals** (spawn sites,
  terminal guards, RPC refusal shapes) and say which regression they'd catch.
  Copy/CSS/existence pins are banned — they pass on broken logic and break
  on refactors. `doesNotMatch` regression pins for removed content are allowed.
- **No circular validation on critical paths:** the agent that wrote the code
  may not be its test's only author — spawn a fresh subagent with the
  requirement alone to write or red-team the test
  (see `stelow-workflow-testing-ai-code`, anti-patterns).
- **Batch triage via subagents:** contract-file cleanup is mechanical
  keep/convert/delete classification — delegate per file, decide on the table.

## State honesty (product principles, not preferences)

- Any user-facing wait needs a live question behind it. Phantom waits
  (idle text with nothing answerable) are bugs.
- Inbox resolution is per event kind, never blanket. The badge counts
  unresolved action items only; resolved items persist under history.
- One primary action per card state. Destructive actions live behind
  confirm dialogs in Manage, never as the prominent choice.
- Every destructive or background operation leaves an openable record: a
  trail comment naming the outcome plus its evidence (files, SHAs,
  counts), never a bare toast. Terminal output streams where it runs;
  confirm dialogs state the exact blast radius with details before
  anything runs.
- Touch targets are `min-h-11`; every clickable gets `cursor-pointer`
  (Tailwind v4 does not imply it); text fields keep the text cursor.

## Releases

Releases run on release-please: every push to `master` refreshes the
open release PR (version bump in `package.json`/`package-lock.json` +
generated notes); merging it cuts the `vX.Y.Z` tag and the GitHub
release. The merge is the release — never tag or `gh release create`
from a laptop.

**The release PR accumulates. Do not merge it per change.** Land the
change (branch → PR → squash-merge), and leave the release PR open: the
next push to `master` refreshes it with the new commit's bump and notes.
Merge it when you want to cut, not when it first appears. This section
described the mechanism for a long time and said nothing about cadence,
which is how one session shipped six releases in a day — v0.74.0 through
v0.78.1, each technically correct and each a version every install has
to move through. The mechanism was never the problem; merging on sight
was. A day of UI work is one minor release, not five.

A `fix:` on top of a `feat:` still bumps minor while both are pending,
because release-please takes the highest type in the accumulated set —
which is the second reason to let it accumulate rather than shipping the
patch first and the feature after it.

**Never push to `master` directly — branch, then PR, always.** Every
release rule above is written for a merged PR, and a direct push breaks
them silently: the squash commit's subject is then the *branch's last
commit* rather than a title chosen for the change type, so a batch of
`fix:` commits that carries a `feat:` ships as a patch with the feature
absent from the notes. It also leaves no review point, which is the one
thing the release process is built on. Pushing and then reverting with
`--force-with-lease` works, but it publishes a wrong master first —
avoid it rather than repairing it.

Never merge the release PR unreviewed. Curate the generated notes in
the PR first when the Keep-a-Changelog prose needs a human touch, and
confirm CI is green on it. Keep feature commits separate; the release
PR owns the version bump.

**Curate `CHANGELOG.md` on the release branch, never the release PR
body.** Release-please parses its own release PR body to recognise
that PR as its own. Rewrite that body and it can no longer parse it
(`could not parse pull request body as a release PR`), stops seeing
its own release PR as merged, and never publishes the tag. On v0.57.0
that is exactly what happened: the body was hand-edited to restore a
feature entry release-please had dropped, and the release silently
never shipped. The prose belongs in the `CHANGELOG.md` section on the
release branch, which release-please regenerates only when new commits
arrive, so it survives until the merge. A body edit surviving later
runs is a different question from whether release-please can still
read it, and after such an edit it cannot.

`scripts/check-release-published.mjs` fails the release run when
master carries a version that has no tag and no open release PR for
it. Run it after any manual tag or release change; the workflow runs
the same check.

**A release PR's `verify` can sit in `action_required` with zero
jobs.** Observed four times, always on the release-please branch and
always intermittent — the same branch also passed cleanly. It is a
platform-level approval gate on `pull_request` events, not a test
failure: the run never starts, so there is nothing to read in the log.
Approve it and it proceeds:

```bash
gh api -X POST repos/calionauta/bb-plugin-stelow/actions/runs/<run-id>/approve
```

Do not re-run it instead, and do not merge around it: a check that
never executed is not a passing check, and merging the release PR on
one leaves the version bump unverified.

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

**A squash-merged PR is typed by its branch commits, not by its title.**
This repo sets `squash_merge_commit_title = COMMIT_OR_PR_TITLE` with
`squash_merge_commit_message = COMMIT_MESSAGES`, so a multi-commit
branch is squashed under the **last commit's** subject and the
individual messages survive in the body. The subject — the only line
release-please reads for the change type — therefore comes from a
commit, and the title never types the release. This is not
hypothetical: PR #211 carried a `feat:` commit and a `fix:` commit
under a `feat:` title, and master recorded the `fix:`, shipping a
feature as a patch. PR #157 mixed the design-ref feature with three
fixes and a sync, and release-please computed 0.56.5 for work that
had to ship as 0.57.0.

Two consequences, both now rules: the **last commit** on a branch that
carries a feature is `feat:` even when it also carries fixes, and a
feature never shares a branch with unrelated fixes. When a bump is
already wrong — the release PR is open and says the wrong version —
correct it through the release workflow's own `release-as` input
(`gh workflow run release.yml -f release-as=<version>`), never by
editing `package.json` in the release PR, which release-please
overwrites. A `BREAKING CHANGE:` footer on a 0.x line computes 1.0.0
and that milestone is refused by `check-release-major-claim.mjs`,
which points back at `release-as`; `bump-minor-pre-major` cannot
soften it, because passing `release-type` on the action makes
release-please ignore `release-please-config.json` entirely.

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
