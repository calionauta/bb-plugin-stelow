# GitHub issues: import now, watch automatically

User documentation (canonical):
https://calionauta.github.io/stelow/docs/plugin/github-issues/

Operator summary: one Build entry point with Import now (manual) and
Auto-import (per-project label watchers) sharing one matcher, one intent
heuristic, one creation path, and one `github_imports` dedupe. Parked
drafts by default; auto-start only into isolated worktrees (fail-closed);
10 drafts per rule per tick; explicit human-gated write-back. Full
semantics: https://calionauta.github.io/stelow/docs/plugin/automation-rules/

Maintainer notes below (module map, removal contract, background).

## Module map (for maintainers and agents)

- `server/github-issues.ts` — the seam and nothing else (58 lines): it builds
  the client, the warn-once registry, and the handler map out of the slices
  below, and returns the two schedulers. Every job lives in its own slice:
  - `server/github-automation-context.ts` — the deps shape every slice
    receives (`db`, `bb`, clock, preset and card operations), the kill
    switch, and warn-once.
  - `server/github-client.ts` — the typed `github` plugin RPC bridge:
    status (never throws), the issue/comment/label calls, and the
    fail-soft per-repo pickers.
  - `server/github-migrations.ts` — `runGithubMigrations`: the tables, the
    column ALTERs, and the one label backfill.
  - `server/github-issue-flow.ts` — candidate listing, the shared
    claim-first issue → card path, and issue creation for a card.
  - `server/github-automation-rules.ts` — the rule row shape, priming
    (the backlog guard), and the scheduler tick.
  - `server/github-rule-rpcs.ts` — the five watcher-rule RPCs.
  - `server/github-comments.ts` — the linked-issue comment mirror (read
    and post) and the mirror poller.
  - `server/github-completion.ts` — the completion write-back and its body.
  - `server/github-rpc-contract.ts` — the wire shapes; `server/rpc-contract.ts`
    composes them, `server/core-migrations.ts` calls
    `runGithubMigrations`, and `server/plugin-runtime.ts` spreads the 11
    handlers and registers the `stelow-automation-rules` schedule.
- Behavior tests over the real database and the real RPC seam against a
  fake `github` plugin live in `tests/server-github-automation.test.mjs`,
  `tests/server-github-issue-flow.test.mjs`, and
  `tests/server-github-discussion.test.mjs`, on the shared harness
  `tests/helpers/github-harness.mjs`.
- `components/github/` — the dialog shell (`github-issues-dialog.tsx`),
  one state hook (`github-dialog-state.ts`: all tab state, RPC handlers,
  open/re-anchor/switch choreography), the tabs (`github-import-tab.tsx`,
  `github-automation-tab.tsx`), the chrome (`github-dialog-chrome.tsx`:
  tablist + footer), plus the completion write-back dialog
  (`github-completion-dialog.tsx`). `BuildPanelDialogs` keeps the dialog
  trigger; `BuildDetailBody` keeps the completion-draft trigger.
- Pure core with node tests: `lib/automation-rules.mjs` (one decision
  function serves scheduler + dry-run), `lib/github-intent.mjs`
  (intent, authors, prompt threading, related issues),
  `lib/github-automation-gate.mjs` (start policy from the effective
  environment), `lib/tracks.mjs` (`describeCardEnvironment`).
- Tables: `github_imports` (dedupe + claims + write-back stamp),
  `automation_rules`, `automation_rule_fires` (audit + outcome),
  `automation_rule_seen` (backlog guard), `github_issue_comments`
  (discussion mirror, fingerprint primary key).

## Removal (decoupling contract)

The integration is one module set plus narrow seams so a change of mind is a
checklist, not archaeology. To remove it entirely: delete the eleven
`server/github-*.ts` files, `lib/github-issue-create.mjs`,
`lib/github-issue-comments.mjs` (+ tests + `.d.mts` twins),
`components/github-issues-dialog.tsx`, `components/isolated-worktree-check.tsx`,
and `docs/github-issues.md`; remove its fragment from
`server/rpc-contract.ts`, its migration call from `server/core-migrations.ts`,
and its handler spread and schedule from `server/plugin-runtime.ts`; delete
the `GithubIssuesDialog` mount from `components/panels/build-panel-dialogs.tsx`,
`GithubCreateRow` from `components/creation/create-build-dialog.tsx`,
`LinkedDiscussionSection` from the three detail bodies, and the done-draft
dialog from `components/detail/build-detail-body.tsx`; drop the linked tables
(`github_imports`, `github_issue_comments`, `automation_*`) with one
migration. `STELOW_GITHUB_ISSUES=0` already disables everything without
removing a line — prefer the switch unless the code itself must go.

## Background

The design borrows restraints from Sawyer Hood's SlopCop (backlog
priming without dispatch, dry-run that names why-not, marker-verified
write-back) without depending on it: SlopCop dispatches free-form
threads, Stelow needs cards, and the state machine cannot adopt foreign
threads. Deliberately *not* borrowed: automatic PR opening (short-
circuits review gates) and role-based trust (fields don't exist
upstream).
