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

## Stack

- Runtime: Node 22.0 or newer, pinned to the 22 line in `.node-version`;
  dependencies installed from `package-lock.json`, never global.
- App: React 19.2 or newer, TypeScript 5.7 or newer, zod 4.3 or newer
  (exact pins in `package.json`, which is the version of record);
  host engines `bb >=0.43` and `bbPluginSdk >=0.4.6`.
- Tests run on better-sqlite3; lint is oxlint, shape is quality:shape
  (pre-commit hook, CI gate).

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

Sync triggers, pin provenance, and upstream-first repair:
`docs/skills-sync-notes.md`. Read it when cutting, dispatching, or
repairing a sync.

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
`cursor-pointer`"* for a long time, and 82 raw `<button>` elements sat next to a
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
| An optional tool is advertised in the About panel only if the vendored methodology names it, or a ledger entry says why not | `host-tool-consumers` |
| Every installable tool declares how it installs, and the pin is enforced rather than displayed | `runtime-platform` |

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
appears in 100 places doing the same job the scale already names — the size is
allowed, the test counts the sites against a ceiling that only ratchets down, and
the migration is owed but not urgent. The count is measured against
`components/` + `lib/`, which is why it reads 100 while a `components/`-only grep
finds 95: both numbers are right and only one is the one this sentence is about.
The
`min-h-11` rule above is the one this section is least able to keep: it is
stated, not tested, and 82 raw buttons are the standing evidence.

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
- **No agent self-certification in-loop:** the implementing agent never writes
  unit/integration tests to verify its own change, and no mandated TDD
  red-green cycle (ProgramBench 2026: −3.6pp at +55% cost; DeepSWE 2026:
  zero gain from agent-written unit/integration tests). New behavior tests
  are described by the human or authored/red-teamed by a fresh context —
  the rule above extended to every path, not just critical ones.
- **Targeted locally, full in CI:** run the impact subset during work;
  `npm test` stays a CI gate. In-loop full-suite execution measured ~zero
  success gain at real token cost.
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
- A disabled control is not a protection. The RPC and the CLI reach the same
  handler the dialog calls, so a refusal that lives only in the UI is a
  promise either of them can break — enforce it at the save boundary and
  assert the refusal shape in a server test. Precedent: the built-in preset
  environment (the dialog disables it *and* `upsertPreset` refuses the
  write, covered by `server-preset-delete-refs.test.mjs`).

## Releases

Releases run on release-please: every push to `master` refreshes the
open release PR (version bump in `package.json`/`package-lock.json` +
generated notes); merging it cuts the `vX.Y.Z` tag and the GitHub
release. The merge is the release — never tag or `gh release create`
from a laptop.

**The release PR accumulates. Do not merge it per change.** Land the
change (branch → PR → squash-merge), and leave the release PR open: the
next push to `master` refreshes it with the new commit's bump and notes.
Merge it when you want to cut, not when it first appears. A day of UI
work is one minor release, not five.

**Never push to `master` directly — branch, then PR, always.** Every
release rule above is written for a merged PR, and a direct push breaks
them silently: the squash commit's subject is then the *branch's last
commit* rather than a title chosen for the change type, so a batch of
`fix:` commits that carries a `feat:` ships as a patch with the feature
absent from the notes. It also leaves no review point, which is the one
thing the release process is built on. Pushing and then reverting with
`--force-with-lease` works, but it publishes a wrong master first —
avoid it rather than repairing it.

**Name the PR title for the highest change type the branch carries, exactly as
if it were the squash subject — because it may become exactly that.**
The `pr-title` workflow fails PRs whose title carries no conventional
type (or `Revert`) before merge. When a batch already shipped untyped,
recover with a revert plus a conventionally titled re-PR, never by
editing history on `master`.

Two consequences, both now rules: the **last commit** on a branch that
carries a feature is `feat:` even when it also carries fixes, and a
feature never shares a branch with unrelated fixes.

Full runbook — batching, CHANGELOG discipline, stalled `verify`, silent
squash merges, `release-as` recovery, verify-by-content, and the frozen
0.3 line: `docs/release-runbook.md`. Read it when cutting, merging, or
recovering a release.

Incident narratives behind these rules live in `docs/release-incidents.md`.

## Frozen 0.3 migration line

The 0.3 preview line is frozen forever: tags `v0.3.80`–`v0.3.88` are
one-shot migration releases — never move, delete, or retag them.
Install-era protocol and the range rule: `docs/release-runbook.md`.
