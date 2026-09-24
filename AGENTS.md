# Plugin development

## Commands

- `npm run build:reload` — after every change and after each `package.json#version` bump: builds the bundle and reloads the plugin in the running BB; use `npm run reload` when the UI still looks stale (do not rely on `npm run build` hot-reload alone).
- `npm run typecheck` — must be green before committing.
- `npm test` — full suite; must be green.
- `node scripts/sync-stelow-assets.mjs` — manual skill/data sync (pinned commit; then `npm run reload`).
- `grep dist/` — confirm the bundle actually contains the change; the reload version string is unreliable.

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

## Transitions are enforced in one place

Stage/mode rules live upstream (`scripts/stelow` `do_advance`, mirrored
in the vendored `transitions.md`). Every refusal must
name a valid redirect — a refusal without an exit is a deadlock with a
good error message. Verify all paths live with fixture `state.md` files
before shipping guard changes.

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
does not exist. Deep operator/maintainer guides live in `docs/`
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
Load `/skill:stelow-product-coding-standards` (KISS, DRY, convention over
configuration, plus LoB/SoC/Fail Fast/YAGNI with file/function size limits)
before writing or reviewing code. If the skill is not installed, install it
with `npx skills add calionauta/stelow@stelow-workflow-coding-standards`
(same standard, public source) and continue.

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
  (see `stelow-product-testing-ai-code`, anti-patterns).
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

Never merge the release PR unreviewed. Curate the generated notes in
the PR first when the Keep-a-Changelog prose needs a human touch, and
confirm CI is green on it. Keep feature commits separate; the release
PR owns the version bump.

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
