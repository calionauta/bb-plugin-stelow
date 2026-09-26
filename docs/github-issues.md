# GitHub issues: import now, watch automatically

One Build entry point ("GitHub issues") with two triggers that share
everything underneath: **Import now** (manual pull while you watch) and
**Auto-import** (per-project label watchers on BB's scheduler). Both funnel
through one matcher, one intent heuristic, and one card-creation path, so
manual and automatic can never draft the same `repo#number` twice.

## Guarantees

- **Single dedupe.** `github_imports(issue_key → card_id)` is the one
  source of truth, claimed with an owner token *before* any work starts.
  A concurrent manual click and scheduler tick cannot both pass the
  check — the loser reads `already-imported` or `in-flight`. Liveness
  is verified by existence, never by a bare non-null: a deleted card's
  issue reads as not-imported and can come back.
- **Parked by default.** Both flows ship with Start unchecked. Creation
  dialogs default to started; GitHub flows default to parked Bucket
  drafts. Presence decides the default.
- **Isolated auto-start.** A rule starts workers only into an isolated
  worktree, verified against the *effective* spawn environment (band
  routing wins over any passed preset — checking preset existence is not
  enough). Without one it fails closed: save refuses, ticks park with
  the fix named in a trail comment.
- **Backlog guard.** Enabling a rule records currently-matching issues as
  seen without drafting. If GitHub is unreachable, the rule is saved
  *disabled* instead of firing blind on the backlog next tick.
- **Verified write-back.** Completion summaries carry a hidden card
  marker that is matched back on the issue before counting as posted.
  Retries never double-post; a send with no visible comment reports
  itself. Posting is explicit and confirmed — never automatic.
- **Bounded blast radius.** 10 drafts per rule per tick; rules never
  move cards, merge code, or clear labels behind the user's back
  (the import clears its own trigger labels so the loop is pull-once).
- **Named checkout.** Every card records its spawn environment in one
  stored word (isolated worktree, shared checkout, BB-managed,
  exploratory) and the open card shows it plus the live branch —
  decided once at spawn from the resolved environment, read back
  afterwards, never guessed from paths.

## Configuration

Per rule, per project: labels (comma-separated, **all** required, exact
case-sensitive match), optional author allowlist (empty means anyone),
optional worker-instructions template appended to the issue prompt, and
the start policy. A dry-run preview names what would match now and
exactly why the rest would not (`missing-labels`, `untrusted-author`,
`other-project`, `already-fired`, `already-imported`); each rule lists
its recent runs with the per-run outcome (`Started`, `Parked`,
`Already imported`).

Issue intent (bugfix/feature/…) is derived server-side from labels and
title (`lib/github-intent.mjs`) and stays correctable afterwards via
Reclassify. Candidates show author, card status, posted state, and
possibly-related open issues by title overlap (advisory only).

## Trust model

Issue text is **untrusted input**: it lands verbatim in a worker prompt
on your machine, and no BB permission mode is read-only. The allowlist
is the gate (the official `github` plugin exposes author logins but no
role associations, so role-based trust is impossible — this is explicit
logins or nothing). Prefer parked drafts for public repos; reserve
auto-start for member-only traffic into worktrees.

Defense in depth, cheapest first: exact-label matching → author
allowlist → parked default → worktree isolation → file-claim
coordination on shared checkouts → 10/tick cap.

## Operations

- Scheduler: every 5 minutes (`stelow-automation-rules` for watchers,
  `stelow-github-discussion-mirror` for linked-issue comment mirrors).
  Persistent config states (repo with no BB project yet) warn once per
  daemon lifetime and self-heal.
- Card-birth issue creation (`createLinkedGithubIssue`): opt-in checkbox in
  the Build creation dialog, off by default. The card is always created
  first; `gh` then posts title plus prompt with a hidden card marker, and
  the link lands in `github_imports`. Title and body only; a failed creation
  keeps the card, and an unconfirmed write reports uncertain instead of
  inviting a double-creating retry.
- Linked discussion mirror (`getLinkedDiscussion`, `postIssueComment`):
  read-only, append-only snapshot of the linked issue's comments (identity
  is a content fingerprint; edits/deletes upstream are not tracked).
  Fetched live on card open plus the mirror schedule for linked,
  non-terminal cards; terminal cards serve their frozen snapshot. Mirrored
  text renders badged and never routes to workers. A composer posts back
  through `postIssueComment` behind an inline confirm naming the
  destination — human gesture only, payload validated server-side.
- Done-note draft (`draftDoneComment`, main contract): cheap generation
  preset drafts a completion note on dialog open; artifacts ride as a
  detachable checklist; Post reuses the human-gated comment RPC.
- Kill switch: `STELOW_GITHUB_ISSUES=0` on the host disables the
  scheduler, every RPC (each refusal names the variable), and the panel
  button. No migration, no UI change.
- Troubleshooting: "saved disabled" means GitHub was unreachable at
  save — re-enable to prime and go live. "Parked, no worktree preset"
  means create a New-worktree preset in Agent Presets. "In-flight" on
  manual import means another flow is creating that card — refresh.

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
