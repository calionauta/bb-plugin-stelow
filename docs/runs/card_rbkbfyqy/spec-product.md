---
name: slice-b-recent-deliveries-view
product_type: software
intent: feature
quality: production
exploration_count: 3
exploration_hybrid: true
review_mode: Product Spec + Interface + Scopes
review_mode_source: setup
stage: shape
version: 2
created_at: 2026-10-28
approved: true
approved_at: 2026-10-28
approved_via: "card gate — plan approved, three product questions answered"
gate_decisions:
  expansion: "Slide-over panel, chosen over a tab inside the flow surface"
  fleet_line: "Newest release across all projects plus how many shipped, fixed height"
  untagged_documented_release: "Left out; the gap sentence carries it"
stages_chosen_by_human: "Interface + Tech Planning — the human's answer to the card's stage question. A heavy shaping cycle is not wanted; the product framing below is inferred from the two reconnaissance passes, and the interface gets the real exploration budget."
decision_reads: >
  runs/exec_wfurtsri/recon/setup.md · runs/exec_hvew3r95/recon/shape.md ·
  session.log (context gate blocked, no strategic pass)
assumptions_resolved:
  - core_flow: "Human opens the Stelow panel's board; with a project selected it names that project's newest release; with no project selected it names the newest release of every project that has one. Opening the drawer lists the last five releases with one takeaway line each."
  - target_user: "The single operator who supervises several projects on this host — the person who today leaves bb and reads git log by hand. Not an agent, not a per-user preference."
  - business_rules: "'Shipped' is a git tag, not a card and not a ledger row. The board's existing flow strip already owns 'what finished' as cards, so this surface reports releases and never restates card counts."
  - risk_domain: "A confident wrong claim. Three of six checkouts sit behind their own tags, so a working-tree read reports 0.87.0 while 0.99.0 shipped that morning. Every empty state must say which emptiness it is."
  - tech_hints: "One pure lib/ module with a node test, one strict git reader, one RPC, one board surface. Reuses parseReleaseTag for filtering; orders by tag date, never by version."
---

# Spec — Recent deliveries view

## Problem

The board answers "what finished" from the card ledger: the flow strip renders finished
counts, lead and cycle percentiles and a per-card table. It cannot answer "what shipped",
because releases do not live in the ledger — they live in git tags and in each repository's
`CHANGELOG.md`, and nothing in the plugin reads either. `grep -rln CHANGELOG server components
lib` returns one hit, and it is a prompt string about commit conventions.

So the operator does what the product should do: leaves bb, changes directory into each repo,
and reads `git tag`, `git log` and `CHANGELOG.md` by hand to find out what shipped lately and
what it was about. With six release-bearing projects, that is six manual reads per question,
and the answer is only as good as the branch each checkout happens to be on — three of the six
are behind their own tags today.

The parent request asked for a panel of active decisions and project deliveries. This card owns
only the second half, and only its release axis: what recently shipped per project, plus the
takeaway that makes a version number mean something.

## Solution

One project-scoped read of the release record, and one surface on the board that names it.

The read has a spine and an enrichment. The spine is the tag list, filtered by the version
pattern that already exists (`parseReleaseTag`); the enrichment is the changelog entry whose
version matches a tag. A release row carries version, date, whether the changelog documents it,
and one takeaway line — the indented prose paragraph under the entry when the release has one,
the first bullet when it does not, and nothing when neither exists. No model writes the
takeaway: it is extracted from the release's own text or it is absent.

Ordering is by tag date, descending, with version as a tie-break. Version order is wrong here
and measurably so: one project carries a `v1.x` line from August and a `v0.8x` line from
October, so sorting by version puts twelve September at the top of a project whose last
release was 27 October. Thirty-two groups of same-day releases exist in this repository alone,
so the tie-break is not an edge case.

Absence is a state, not an empty list, and it lives on two levels. At project level: `no repo`
(the path is not a repository), `no tags`, `no release record` (a changelog with no heading that
parses as a release), `path missing`, and `unreadable` (the read itself failed). At row level:
one release whose changelog entry does not exist. None of them may render as "nothing shipped",
and eight of the fourteen projects on this host are the first two — which is a fact about the
project, not a fault.

The read has stated bounds instead of implied ones. The strict reader gives each git command a
ten-second timeout and a four-megabyte buffer. The fleet call settles every project on its own,
so one failing project becomes that project's `unreadable` line and never the call's failure,
and the call as a whole has a fifteen-second deadline, after which any project still unanswered
reads as unreadable. A tag is matched to a changelog entry by exact version text after a leading
`v` is stripped, so a prerelease suffix never borrows the stable release's notes; the numeric
comparator stays a filter and a tie-break.

The wire result is a validated object per project — identifier, name, state, newest release
(version, day, whether the notes document it, the takeaway) and the window's rows — with no
optional field left as `undefined`, because this repository refuses a whole call that carries
one. `day` is a calendar date derived from the tag's own timestamp; the sort uses the same day
and falls back to the version text, which is what makes the order total rather than merely
stable.

The surface: with a project selected, one line naming that project's newest release — version
and date — and, on demand, the last five releases with their takeaways. With no project
selected, one fixed-height line summarizing the fleet: the newest release across it, and how
many projects shipped. The per-project breakdown belongs to the expansion, never to an
always-on list, because six stacked lines do not fit a board whose height is already spent.

Expansion is a slide-over panel that opens over the board and leaves the cards in place — never an
inline expander that pushes the kanban, which is a bug the flow strip's own comment already
records. A row shows version, date and the takeaway clamped to two lines, and expands in place to
the full text when the release has more. This surface owns releases only and must not depend on
the flow strip's finished-card count, so a project with releases and no finished cards still sees
it.

## Dangers

| # | Failure | What makes it happen | What the design does |
|---|---|---|---|
| D1 | Reports an old release as the newest | A project checkout is on a feature branch: three of six today, one by 76 commits | Read the changelog blob at the tag, never the working tree; fall back to the tree only when there are no tags, and say so |
| D2 | Hides the newest releases | A project carries two version lines | Sort by tag date; version is the tie-break only |
| D3 | A "recent" list omits shipped work | One project documents 3 of its newest 10 tags | Tags are the spine; the undocumented count is stated, never dropped |
| D4 | Rows with no text | One changelog dialect reuses `## ` for body sections, so a naive split yields empty bodies | Split at the next release heading, not the next `## ` |
| D5 | Backup tags render as releases | Four of six repos carry `archive/…`, `backup/…`, `pre-merge-backup` tags | Filter with `parseReleaseTag` |
| D6 | Rows swap places between renders | One date carries 35 releases in this repository | Stable sort on date, then version |
| D7 | An unreadable repo reads as "no releases" | The existing git runner collapses every failure into an empty success | A strict reader with typed failures; a test asserts `unreadable ≠ no releases` |
| D8 | The board gets slower | A serial read of every project costs ~360 ms | Parallel fan-out over repos (~100 ms); changelog blobs read only when the drawer opens |
| D9 | A second "delivered" claim appears | The flow strip already renders finished cards | This surface reports releases only and never restates card counts |

## Out of scope

- The GitHub Releases API: no token is configured, the unauthenticated ceiling is 60 requests
  per hour per address, and it cannot answer for a project whose notes are only local.
- Model-written takeaways: the takeaway is extracted from the release text, never generated.
- Per-release drilldown (tag diff, commit list): the fastest route from a lean slice to a
  history browser.
- A command-line verb for agents: the interface is the requested surface, and the pure module
  makes a verb cheap later.
- Persistence: tags are the source; a table would be a second truth to invalidate.
- Notifications or digests: "tell me when" is a different product from "show me now".
- Projects sourced from another host, changelog backfill, and any surface for the seven
  projects that are not repositories.

## Alternatives

| Option | What it is | Why rejected |
|---|---|---|
| Read the GitHub Releases API per project | Published notes as the canonical "what shipped" | No token; 60 requests/hour; answers nothing for a local-only project |
| Duplicate finished cards as "recent deliveries" | Reuse the ledger the flow strip already reads | The card warns against it, and the flow strip already owns that axis |
| Changelog only, read from the working tree | Cheapest possible read, ships in a day | Reports 0.87.0 while 0.99.0 shipped; confidently wrong on the operator's own machine |
| Tag spine + changelog enrichment | Tags give recency and truth; the changelog gives meaning | Chosen — correct for all six projects and it shows the gap instead of hiding it |
| Extend the board call instead of adding one | Reuse the root the board already resolves | Puts a subprocess on every board render; a separate call lets the drawer fetch lazily |

## Scope Table

| Scope | In or out | Why |
|---|---|---|
| Pure release module + node test | In | The parser, the selector and the one-line summary, one unit test per dialect and per refusal |
| Strict git reader | In | Two commands per repo, typed failures; the existing runner cannot distinguish unreadable from empty |
| One read call answering one project or the fleet | In | One handler serves both board states |
| Board summary line + drawer | In | The newest release per project, the last five with takeaways |
| Feature inventory entry | In | The repository requires a user-facing feature to be listed |
| Untagged-but-documented release as a row | Out | Tags are the spine; the gap sentence names the other direction instead |
| Per-release drilldown | Out | Named above; it is the one expansion that breaks the planned breadth |

## Decisions taken at the approval gate

The three questions above were answered by the person who owns the card, so they are settled
rather than delegated:

1. **Expansion surface — a slide-over panel.** The release list opens over the board from the
   side; the cards stay where they were. Not a tab inside the flow surface.
2. **The fleet line — newest across all projects, plus how many shipped.** One fixed-height line,
   the same whatever the project count. Not a per-project list.
3. **A documented release with no tag — left out.** The line still names the mismatch (notes
   ahead of tags), so nothing is hidden and no rule for "shipped without a tag" is invented.

Settled by the critique, no longer open: the expansion is never an inline expander; a row without
takeaway text says so in a fixed phrase instead of rendering empty; the gap count is stated within
the window the surface can see; there is no age stamp and no refresh button, because the panel
re-reads when it opens; and the surface uses one type step and no icons.

## Critique resolutions

The plan critique recorded twenty gaps; seventeen were resolved in this document and are listed
with their resolutions in `critiques/critique-report.md`. One carries forward as planning work, not
as a product question: the tech plan must add a test scope for the parser and the absence states,
and verification must run the host gates. The three above are for the approval gate.
