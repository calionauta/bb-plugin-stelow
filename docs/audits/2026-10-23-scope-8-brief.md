# SCOPE-8 brief — re-derivation of the declaration surface

**Type:** spike brief for a fresh-context agent (read-only + one record commit).
**Date:** 2026-10-23
**Why a fresh context:** every premise of the original SCOPE-8 came from a branch
carrying someone else's WIP, and four of this plan's premises have already turned
out dead. Your job is measurement, not agreement.

## Where things are

- Your worktree is a clean checkout of `origin/master`. Measure **there**.
- The audit record, the plan and the premise recheck live in the shared checkout,
  not in your worktree:
  `/home/deploy/repos/bb-plugin-stelow/docs/audits/` — read them from disk
  (`2026-10-23-stelow-audit.md`, `2026-10-23-stelow-audit-repair-plan.md`,
  `2026-10-23-premise-recheck.md`).
- Never read the shared checkout for facts about the code: it carries another
  thread's uncommitted work. `origin/master` is the authority.

## The question, stated honestly

The audit claimed: "257 hand-written `.d.mts` for 270 `.mjs`: the type surface
exists twice; `declaration-surface.test.mjs` checks only *names*, not
signatures", and proposed a spike with three options — keep, generate, delete.

The recheck killed three of its premises: **`types/` does not exist** (the
`.d.mts` files sit beside their `.mjs` siblings in `lib/`), the counts are
**263/276**, and **generation is not a live third option** because a generated
surface would stop binding the `export declare` names that
`tests/declaration-surface.test.mjs` requires in the sibling `.mjs`.

So the real question is narrower and answerable:

1. **What does `tests/declaration-surface.test.mjs` actually guarantee?** Names
   only, or signatures too? Quote the assertion, don't characterise it.
2. **What happens if a `.d.mts` drifts from its `.mjs`?** Prove it: in your
   worktree, change one declaration's signature (not a name) and run
   `npm run --silent typecheck` and `node tests/declaration-surface.test.mjs`.
   Capture both exits. Then revert.
3. **Is the hand-written surface load-bearing at all?** Count how many `server/`
   files import a `lib/*.mjs`; for each such module, does a `.d.mts` exist? If
   some are imported without a declaration, what does TS do (implicit `any`)? Give
   the number.
4. **Cost of the status quo, measured:** `wc -l` across the declarations, and how
   many of them a `tsc --declaration` run on the `.mjs` sources would reproduce
   byte-for-byte — try it on **three** representative modules only (pick a small,
   a medium and one with generics) and report the diff size. Do not attempt the
   whole tree.
5. **Verdict with numbers:** keep, or migrate to generated declarations. Name the
   one thing that would have to become true for the other option, and the risk of
   each.

## Deliverable

- A record at `docs/audits/2026-10-23-scope-8-record.md` **committed on branch
  `spike/declaration-surface-2026-10-23` in your worktree** — the measurement
  tables, the two exits from §2, the three diffs from §4, and the verdict with
  its cost.
- Do **not** push, merge, tag, or open a PR.
- Do **not** migrate anything. A spike that changes code is a rewrite nobody
  reviewed.
- If a measurement contradicts the recheck, say so plainly and show the command.

## Report

Under 300 words: the verdict, the four numbers that decide it, and what a human
must decide that you cannot (version bump, whether a breaking type change is
acceptable).
