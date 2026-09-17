# Plugin development

After every change to this BB plugin, run `npm run build:reload` before handing off or committing. It regenerates the bundle and explicitly reloads this plugin in the running BB process without interrupting threads.

`npm run build` may hot-reload when `dist/` becomes newer, but do not rely on that signal alone during development. Use `npm run reload` after a successful build whenever the UI still appears stale. Reopen the plugin panel afterwards; use a browser refresh only if the panel remains stale.

When changing `package.json#version`, run `npm run build:reload` after the version bump so the Plugins screen reports the new version.

Do not restart `bb-daemon.service` to reload this plugin; it terminates active BB threads.

## Dispose hooks

`bb.onDispose` fires on every hot-reload, not just uninstall. Only clear
timers and close handles there — never stop threads, delete data, or do
anything destructive. Killing worker threads on dispose massacres in-flight
work on each update.

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
does not exist.

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
Load `stelow-product-coding-standards` (KISS, DRY, convention over
configuration, plus LoB/SoC/Fail Fast/YAGNI with file/function size limits)
before writing or reviewing code. If the skill is not installed, install it
with `npx skills add calionauta/stelow@stelow-workflow-coding-standards`
(same standard, public source) and continue.

All changes — code, comments, docs, CHANGELOG, UI copy — are in English.

## Verify before commit

- `npm run typecheck` and `npm test` must be green.
- Confirm the bundle actually contains the change (`grep dist/`): the
  version string in reload output is unreliable.

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
