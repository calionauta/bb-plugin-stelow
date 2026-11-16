---
spec: plans/spec-product.md (v2, approved 2026-10-28)
scope_map: scope-map.json (card-rbkbfyqy-scope-map-v1)
selected_interface: interfaces/selected-interface.md (D-hybrid-chip-with-own-drawer)
selected_architecture: architecture/selected-architecture.md (A-split-reader)
stack: existing:node (TypeScript server + React UI + lib/*.mjs pure modules, node:test)
stack_research: runs/exec_1u1m1qu8/plans/stack-research.md
testing_strategy: runs/exec_1u1m1qu8/plans/testing-strategy.md
planning_alignment: runs/exec_1u1m1qu8/plans/planning-alignment.md
product_type: software
intent: feature
review_mode: Product Spec + Interface + Scopes
gate: none (plan-gate skipped in this review mode)
version: 1
---

# Spec Tech — recent deliveries view

## 0. What ships

A chip on the Build board that names the newest release of the selected project (or, with no
project selected, the newest release across the fleet plus how many projects shipped), opening a
right-side slide-over with the last five releases and one extracted takeaway each. Three layers
behind it: a pure parser, a strict git reader, and one validated call. Five scopes, sequenced
below.

## 1. Identified Scopes

[SCOPE-1] Pure release-record module and its node test
[TYPE] feature
[TARGET_FILES]
- lib/project-releases.mjs
- lib/project-releases.d.mts
- tests/project-releases.test.mjs
Dependencies: none

| Task | Done Criterion |
|---|---|
| Write the pure module: heading parser, row builder, window selector, one-line summary | Every exported name is bound in the declaration file and the declaration-surface test stays green |
| Cover four dialects plus `[Unreleased]` exclusion by version pattern | One fixture per dialect asserts parsed version and day; `[Unreleased]` never becomes a release |
| End a body at the next release heading, never at the next `## ` | The `## What's Changed` fixture yields non-empty takeaways for every release |
| Match notes to tags by exact normalized version text | `0.84.1-alpha` never borrows `0.84.1`'s body |
| Order by day descending, then version text descending | Two sorts of the same input are byte-identical on a many-same-day fixture |
| Takeaway = indented prose paragraph, else first bullet, else null | One fixture per case; the null case renders the fixed phrase downstream |

[SCOPE-2] Strict tag reader and bounded fleet fan-out
[TYPE] feature
[TARGET_FILES]
- server/runtime/project-releases.ts
- tests/project-releases-reader.test.mjs
Dependencies: SCOPE-1

| Task | Done Criterion |
|---|---|
| New strict reader beside `runGitIn`, never an edit to it | `git-evidence.ts` has no diff; the new module owns its own process call with a 10 s timeout and a 4 MiB buffer |
| Two commands only: `for-each-ref` for the spine, `cat-file -e`/`show` for an opened blob | A test counts spawned commands: one for the spine, one per opened project |
| Derive `day` from the tag's own timestamp through one explicit formatter | A fixed instant yields the same `YYYY-MM-DD` under two process timezones |
| One typed state per project: ok, no-repo, no-tags, no-record, path-missing, unreadable | A test asserts `unreadable ≠ no-releases` and that a non-repository path never inherits a parent repository's tags |
| Independent settle under an aggregate deadline | One throwing project leaves the call successful, that project `unreadable`, the rest `ok` |

[SCOPE-3] One projectReleases call for one project or the fleet
[TYPE] feature
[TARGET_FILES]
- server/project-releases-contract.ts
- server/rpc-contract.ts
- server/runtime/wiring/rpc-surfaces.ts
- tests/project-releases-contract.test.mjs
Dependencies: SCOPE-2

| Task | Done Criterion |
|---|---|
| New contract fragment, registered; never an inline addition to the 373-line card contract | Composition imports clean and the card contract's line count is unchanged |
| Input `{ projectId: string \| null }` through the optional-input helper | Calling with no argument, with null and with an id all validate |
| Output carries every scalar, nullable where empty | A test asserts no `undefined` in the result and that `unreadable` and `no-tags` stay distinct strings on the wire |
| Handler built at module scope beside the flow-metrics precedent | Wiring file stays under budget; the handler is not inline in the table |

[SCOPE-4] Board chip and slide-over
[TYPE] feature
[TARGET_FILES]
- components/board/release-chip.tsx
- components/board/release-list.tsx
- components/panels/build-panel-view.tsx
- lib/drawer-side.mjs
- tests/release-chip.test.mjs
Dependencies: SCOPE-3

| Task | Done Criterion |
|---|---|
| Chip mounted beside the board's filters, never inside the finished-card strip | A rendered test mounts a project with releases and no finished cards and finds the chip |
| Label carries the release: version and day; fleet state names the newest plus how many shipped | Rendered assertions for both board states; no card count anywhere in the label |
| Slide-over uses the right-side drawer shell and leaves the board mounted | A rendered test asserts the board stays in the DOM and placement is read through the drawer-side module |
| Rows clamp the takeaway to two lines and expand in place | A rendered test expands the longest takeaway; a row without notes shows the fixed phrase |
| Touch target and keyboard: min-h-11, cursor-pointer, aria-expanded, Escape closes, focus returns | A rendered test drives keyboard open and close and asserts focus returns to the chip |

[SCOPE-5] Feature inventory, portable pattern and recorded proof
[TYPE] feature
[TARGET_FILES]
- FEATURES.md
- dist/
Dependencies: SCOPE-4

| Task | Done Criterion |
|---|---|
| One FEATURES.md bullet beside the board surfaces | States releases, never deliveries, and never claims to extend the finished-card strip |
| Portable-pattern proposal for the upstream blueprint, separate commit in the stelow checkout | The proposal exists and is linked; the plugin commit does not carry it |
| Run lint, source shape, typecheck and the full suite | All four exit 0 at the final commit |
| Prove the bundle carries the change | After a build and reload, a grep of `dist/` finds a string the feature itself emits, not a filename |

## 2. Sequence

1. SCOPE-1, then SCOPE-2, then SCOPE-3, then SCOPE-4, then SCOPE-5 — strictly linear, because each
   layer's contract is the next layer's input and the row shape must exist before the reader can
   be tested against it.
2. The parser's and the absence states' tests are written or red-teamed from a fresh context, per
   the repository rule that an implementer is never its own test's only author.
3. The plan gate is skipped in this review mode; verification runs the host gates after execution.

## 3. Dependencies

- No new package: `child_process`, `node:fs`, zod and the existing drawer shell cover everything.
- `runGitIn` is untouched; the strict reader is a sibling by design.
- The scope map is the source of scope identity; this plan adds no scope and cuts none.

## 4. Risks carried from research

| Risk | Mitigation in this plan |
|---|---|
| Parser outgrows the 400-line / 50-line budgets | Split by responsibility — dialect table as data, ordering, extraction — not by convenience |
| Absence tests pass while a broken repo reads as "no releases" | A test asserts the two states differ; the reader uses a two-step existence check because one command exits 128 for both causes |
| Rendered tests pin class strings and pass on broken layout | Placement read through the drawer-side module; assertions on rendered DOM |
| Spec numbers go stale | Behaviour is asserted, never a count; the fleet is re-measured at execution |
| One huge changelog stalls the fleet call | Per-project settle plus an aggregate deadline; 4 MiB buffer, 10 s per command |

## 5. Out of scope, restated once

GitHub Releases API, generated takeaways, per-release drilldown, a CLI verb, caching, remote-host
projects, changelog backfill, and any surface on the research or explore boards.
