# Skills sync notes

Trigger, provenance, and repair for the vendored Stelow sync. The
commands live in `AGENTS.md` (`## Skills sync`); this file holds the
failure modes and the exact commands. Read it when cutting,
dispatching, or repairing a sync.

## Dispatching the sync

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

## Pin provenance

**A pin must be a ref upstream released, not just a ref that exists.**
`check-upstream-drift.mjs` proves the vendored tree *equals* the pin; it
says nothing about whether the pin was worth following, and this repo
pinned the tip of an unmerged branch once (`abc51fb`, from
`fix-question-copy-verify`) with the drift gate reporting a perfect
match. `npm run check:pin-provenance` asks GitHub whether the pinned
commit is on upstream `main` and fails closed when it cannot tell; CI
runs it in `verify`. The verdict logic is a pure function in
`lib/pin-provenance.mjs`, so the rule is testable without a network.

## Upstream-first repair

**Sync-owned content that disagrees with upstream is a bug in the
plugin, and it is invisible until the next sync silently reverts it.**
The drift shows up as an uncommitted diff in `skills/`/`data/`, or as a
commit whose content matches nothing in the pinned ref — check with
`git show master:skills/<file>` against the upstream ref rather than
trusting the commit message. The fix is always upstream-first (fix
methodology in `calionauta/stelow`, cut a release, dispatch the sync);
committing the local edit makes the plugin disagree with its own pin
until the next bot run.
