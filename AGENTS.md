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
- `data/stelow` is a plugin-owned fork of the upstream helper. Safe to edit.
- `lib/` + `tests/` are owned. New state-machine logic belongs in `lib/`
  with a node test, following `inbox-events` / `ask-cancel` precedent —
  never inline-only in `server.ts` handlers.

## Transitions are enforced in one place

Stage/mode rules live in `data/stelow` (`do_advance`). Every refusal must
name a valid redirect — a refusal without an exit is a deadlock with a
good error message. Verify all paths live with fixture `state.md` files
before shipping guard changes.

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
- Touch targets are `min-h-11`; every clickable gets `cursor-pointer`
  (Tailwind v4 does not imply it); text fields keep the text cursor.

## Releases

Keep feature commits separate. A release is: CHANGELOG entry +
`package.json`/`package-lock.json` bump + `release: vX.Y.Z` commit +
`vX.Y.Z` tag + push both + `gh release create` with English notes.
