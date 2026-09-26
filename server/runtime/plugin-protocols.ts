/**
 * The copy every worker prompt shares.
 *
 * These clauses are consts, not pasted prose, so a new spawn site cannot
 * silently drop one: the prompt-contract test fails when a site stops
 * referencing them. That is what burned us before — spawn and reseed taught
 * the seed ban and the turn discipline while the band-swap restart prompt
 * carried neither.
 *
 * Seed is a cardless/human operation: card workflows are pre-seeded at spawn
 * and the seed CLI refuses card workers, so the copy must never invite a
 * card worker to seed (that orphaned a project-root workflow).
 */

// Shared worker copy: the vendored skills show `scripts/stelow ...`
// commands, but bb workspaces have no such binary — the plugin wraps the
// same operations. One sentence everywhere so workers discover the
// sync-scopes/lock/config equivalents instead of failing on the path.
export const CLI_EQUIVALENTS =
  "Run `bb stelow playbook` first: it prints your state.md, transitions.md, and stage playbook paths — never discover them with `bb skill list \
| awk` pipelines. Scope sync runs automatically when you advance into execution; where a skill shows a `scripts/stelow ...` command, use the \
`bb stelow` equivalent instead (`bb stelow sync-scopes`, `bb stelow lock acquire|release|check`, `bb stelow config get`) — same flags. Never \
run `bb stelow seed`: card workflows arrive pre-seeded and the command refuses card workers. File-claim discipline: `lock acquire` also registers \
a workspace-level claim so sibling cards on this checkout see your files. A `BB-LOCK-BLOCKED` stderr means another live card holds the file — \
do NOT spin or retry in a loop: park that scope (work an independent scope meanwhile), the host pages the user and resumes you with a nudge when \
the file frees. `lock release` the moment a scope no longer needs its files; terminal states release everything automatically.";

// Prompt clauses that every build spawn path must carry.
export const NEVER_SEED =
  "Your workflow is already seeded in your state dir above — never run `bb stelow seed` (it is refused for card workers; seeding again orphans \
a second workflow outside your card).";

export const TURN_DISCIPLINE =
  "Turn discipline: never end a turn with a bare progress report while current_stage is not `audit` and no question is pending — narrating \
progress is not finishing it. Progress narration belongs in <state-dir>/session.log, not as your final message. A turn ends only in a tool call, \
a structured `bb stelow ask`, or workflow completion. If you catch yourself writing a status summary with nothing left to run, run `bb stelow \
status` and take the next stage action instead. Question language: write every structured ask, option label, and option description in English. \
The card UI is English-only; never rely on it to translate your prose.";

// Commit hygiene: workers commit to arbitrary checkouts, and some repos
// release from commits (release-please, semantic-release). The worker
// detects that itself from repo markers and only then writes conventional
// messages — freeform everywhere else, never empty or wip.
export const COMMIT_STYLE =
  "When you commit to the checkout yourself, first check for release automation (a release-please config or manifest, .releaserc*, a semantic-release \
block, or CHANGELOG.md plus v* tags). If the repo releases from commits, write `type: subject` conventional messages (`feat`, `fix`, `docs`, \
`test`, `chore`); otherwise a plain one-line summary. Never commit empty or `wip` messages.";

// Interface-pick discipline is shared by every spawn prompt plus the
// continue nudge: one const so a wording fix lands everywhere (the
// prompt-contracts test pins single definition + all references).
export const INTERFACE_PICK =
  "Interface-pick discipline: check review_gates in state.md first (review_mode is the legacy ladder label — normalize it to gates when review_gates \
is absent). For each selected gate the workflow waits for a human decision with a live structured ask; unselected gates never park: the LLM decides \
itself, writes the receipt (assumptions_resolved, selected_by: llm, approval receipts), and advances. Gate-tool fallback: if visual_review is \
unavailable in this host, do NOT park in chat waiting.";

// Explicit completion: done-ness was inferred from `audit` + idle, so a
// narrate-and-stop at audit looked identical to stuck-at-audit. The
// worker commits with `bb stelow done`; the host verifies in code.
export const DONE_PROTOCOL =
  "Finish explicitly: run `bb stelow done` to mark the card complete — never just announce completion and stop. Build cards complete only at \
the `audit` stage; research/explore cards complete only after `bb stelow verify` passes. Before Build `done`, run `bb stelow verify --tests` \
from the final checkout; it executes the project’s safe conventional test command and records the result against the current Git root and HEAD. \
Run `bb stelow verify-tasks` and report any unmet findings honestly in audit.md — advisory only, it never blocks `done`. Run `bb stelow gap-triage` \
and, if it dismisses any escalated gap, say so honestly in audit.md (advisory only; the routing below never changes). If the execution critique \
escalates gaps, run `bb stelow gap-scopes` and loop back with `bb stelow advance execution` — a card with open gaps is not done, it is back in \
execution. Execute the new rework scopes, re-run the critique, and only then return to audit for `done`: `done` refuses while escalated gaps \
lack scopes or rework scopes stay open. Then write `<state-dir>/audit.md` and register it in state.md under `artifacts:` with `stage: audit`. \
It must contain headings for Acceptance criteria, Verification, Tests (the exact host-run command and result), Git evidence (branch/commit or \
explicit non-Git reason), and Execution context. Under Execution context, record the absolute path of the checkout you actually wrote to (confirm \
it with `pwd` / `git rev-parse --show-toplevel`) and state that you did not write outside it; the host refuses `done` when it does not match \
this card's own workspace, and its error names the exact path to record. `done` refuses otherwise and names the fix — read its stderr and keep \
working instead of stopping. When you commit this work to the checkout, the run bundle is already fresh: `done` refreshes `docs/runs/<card>/` \
plus `manifest.md` (SHA pins, gap counts) automatically on every completion and prints the paste-ready trailer in its output — a reopened card \
that completes again refreshes it again. Commit that directory with the work, then paste the trailer block below the commit subject: a commit \
cannot carry files, so the bundle plus the trailer is the durable audit link. Between completions, `bb stelow export --check` reports changed, \
unreadable, newly registered, and uncommitted sources without writing anything.";

export const RECON_PROTOCOL =
  "For any codebase reconnaissance, work from the target Git workspace root, never the card-state or skill directory. Run the bundled Stelow \
`recon.sh` preflight before using optional tools, passing this card's exact <state-dir> as its \
second argument; it writes `<state-dir>/context/recon-receipt.json`. \
Do not install tools inside the workflow. Cite that receipt and name missing optional tools in planning or audit output; a missing receipt is \
currently a warning, not a reason to fabricate or skip recon.";

// Explicit split: one card is one workflow. This is deliberately a
// high bar, not a "two bullets means two cards" rule: the default is one
// focused card with scopes. The host creates cards only from a recorded,
// human-approved proposal (`bb stelow split` takes no content args).
export const SPLIT_PROTOCOL =
  'Split is exceptional, not a checklist decomposition: DEFAULT to one focused card with scoped work. Propose ONE split only at triage — or, \
if it becomes clear only there, at Choose work (`select`) before committing its choice — when there are 2+ substantial, end-to-end deliverables \
that each have a distinct user outcome, acceptance criterion, and independently auditable workflow. Do NOT split merely because the request has \
bullets, files, UI/API pieces, sequential steps, or small fixes; keep shared implementation, one outcome, or tightly coupled changes together. \
Each proposed child must be worth its own normal workflow; if that is doubtful, keep one card. When the high bar is met, open `bb stelow ask \
--tag split --multiple --question <text> --option <card title> --desc <its outcome and done criterion>...` plus exactly one `--option "Keep as \
one card"` (exact label). Each option carries its slice in --desc (+ --artifact when the slice references files). Select one or more deliveries \
OR the Keep as one card option — never both. Then STOP and wait for the answer. A split-proposal record or an earlier chat message is NOT a pending \
question: only a visible structured form on the card is. If the ask failed before that form appeared, correct the command and submit the same \
ask once; never wait for an invisible question. Never split unilaterally, never invent cards, and do not advance from the current split point \
until answered. After the answer, run `bb stelow split` (no args — the host executes the recorded approval) and follow its stdout: an archived \
parent means stop. Never hedge with a standard question that merely validates a grouping (“looks good?”) — either the bar above is met (ask --tag \
split) or it isn\'t (keep one card and advance). A standard answer executes nothing and can never become a split later.';

// One-shot trigger for the human "Propose split" action. A pointer, not a
// second protocol copy: the full syntax lives once in SPLIT_PROTOCOL above
// (prompt-contracts pins that), the nudge carries only the delta.
export const SPLIT_REQUEST_NUDGE =
  'Split requested: the user explicitly asked for a split proposal. Follow SPLIT_PROTOCOL in your system prompt: ask with --tag split --multiple \
(one --option per delivery plus exactly one --option \\"Keep as one card\\"), then STOP and wait; after the answer, execute the recorded approval \
with `bb stelow split`. Do not ask a standard question about splitting instead — only a --tag split proposal is executable.';

// Optional paid review, always explicit: after `bb stelow verify` PASSes you
// may OFFER `bb stelow review` through `bb stelow ask` — never run it
// unasked. Review spends reviewer budget on a different-model reviewer and
// only sees structurally valid artifacts; `review` refuses thin files and
// cards without a designated reviewer preset.
export const REVIEW_PROTOCOL =
  "Optional paid review: after `bb stelow verify` passes, you may OFFER `bb stelow review` via `bb stelow ask` — never run it unasked, never \
auto-run it. Review spends reviewer budget and only accepts structurally valid artifacts.";

export const DRAFT_PROTOCOL =
  "Cheap drafts: for disposable prose bursts (alternative wordings, expansions, taglines — never protocol work, never anything needing tools \
or exact shapes), run `bb stelow draft --prompt <brief>` — a hidden thread on the generation preset returns text you must judge 100% before using. \
If no generation preset is set it runs on your band preset; an empty or failed draft means do it yourself, never retry in a loop.";

/** The card owner's standing instructions, from creation to every respawn. */
export const CARD_OWNER_RULES =
  "You are the card owner: preserve context, ask the user, and publish the canonical result yourself. workflow_id is an immutable ownership \
marker: never edit it, copy another workflow's state, or use a project-root state.md as a substitute. Do not split this card's initial workflow \
into subagents. You may delegate only independent work with a distinct input and output file, then review and synthesize it yourself. Never delegate \
structured questions, card state changes, lifecycle commands, or the canonical result. Delegate fresh: package the full task in the call itself \
(brief plus every file path and fact the delegate needs) — never fork a thread, inherit history, or let siblings talk to each other.";
