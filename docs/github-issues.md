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
  check — the loser reads `already-imported` or `in-flight`.
- **Parked by default.** Both flows ship with Start unchecked. Creation
  dialogs default to started; GitHub flows default to parked Inbox
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

- Scheduler: every 5 minutes (`stelow-automation-rules`). Persistent
  config states (repo with no BB project yet) warn once per daemon
  lifetime and self-heal.
- Kill switch: `STELOW_GITHUB_ISSUES=0` on the host disables the
  scheduler, every RPC (each refusal names the variable), and the panel
  button. No migration, no UI change.
- Troubleshooting: "saved disabled" means GitHub was unreachable at
  save — re-enable to prime and go live. "Parked, no worktree preset"
  means create a New-worktree preset in Agent Presets. "In-flight" on
  manual import means another flow is creating that card — refresh.

## Module map (for maintainers and agents)

- `server/github-issues.ts` — contract fragment, migrations, matcher
  wiring, scheduler, all 8 RPCs. `server.ts` only spreads the contract
  and handlers, calls one migration function, and schedules one line.
  The seam is an explicit deps object (`db`, `bb`, clock, card ops).
- `components/github-issues-dialog.tsx` — the whole dialog (both tabs).
  `BoardPanel` keeps the button and the open flag.
- Pure core with node tests: `lib/automation-rules.mjs` (one decision
  function serves scheduler + dry-run), `lib/github-intent.mjs`
  (intent, authors, prompt threading, related issues),
  `lib/github-automation-gate.mjs` (start policy from the effective
  environment), `lib/tracks.mjs` (`describeCardEnvironment`).
- Tables: `github_imports` (dedupe + claims + write-back stamp),
  `automation_rules`, `automation_rule_fires` (audit + outcome),
  `automation_rule_seen` (backlog guard).

## Background

The design borrows restraints from Sawyer Hood's SlopCop (backlog
priming without dispatch, dry-run that names why-not, marker-verified
write-back) without depending on it: SlopCop dispatches free-form
threads, Stelow needs cards, and the state machine cannot adopt foreign
threads. Deliberately *not* borrowed: automatic PR opening (short-
circuits review gates) and role-based trust (fields don't exist
upstream).
