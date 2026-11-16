# Two artifact defects found by a real build card

**Type:** fix brief for a fresh-context agent. Both defects were found by running
one real card (`card_wxpaf8ll`) end to end, not by any test.
**Base:** `origin/master` (contains PR #410).

Load `/skill:stelow-workflow-coding-standards` before writing code. The rules that
matter here: KISS, one owner per fact, fail fast, file/function budgets, and a test
that fails on the old behaviour.

## Defect 1: markdown artifacts render as raw text in the modal

The viewer is correct, the classification is not.

`components/detail/artifact-viewer-dialog.tsx:169,179` renders markdown only when
`kind === "markdown"`. A real card's `.md` artifact arrived with a kind that is not
`markdown`, so it fell through to the `<pre>` branch and showed source.

Find where the artifact kind is derived (start at `lib/artifact-manifest.mjs` and
whatever maps extension to kind; the modal's `contentKind` is also a suspect) and
fix the derivation, not the viewer.

**The test that must exist:** an artifact whose path ends in `.md` and whose kind is
NOT supplied by the fixture must resolve to `markdown`. The current tests pass the
kind in, which is why the derivation was never exercised — the same blind spot that
hid `userInputContract` for months. Do not add a fixture that supplies the answer.

## Defect 2: diagrams rendered on pele.run never become artifacts

`server/runtime/diagram-renderer.ts` is a status surface only: it reports
`{ present, version, detail }` and nothing else. There is no code path that takes a
rendered diagram and persists it as a card artifact, so nothing can appear in the
modal. This is a missing write, not a rendering bug.

What the write must respect:

- **One writer for `state.md`.** The worker writes it; there is no `artifacts add`
  verb in the pinned helper (`bash data/stelow schema artifacts` exits 2), and PR
  #410 restored that single-writer rule. Do not invent a helper verb.
- Find where a diagram is produced today (the `pele` module, `PELE_PIN`,
  `createDiagramRendererHandlers`) and where its output goes. If it is rendered
  inline in a conversation and never stored, the question is where the file should
  live: the card's artifact directory, the same one the other 21 artifacts used.
- Artifact entries are path-relative to the card's state dir. A diagram written
  outside that tree cannot be listed, which is likely half the reason it is
  invisible.

**If the answer requires a product decision** (format: SVG vs PNG vs both; whether
diagrams count as artifacts of the stage that produced them, or as a separate
list), record the options and the tradeoff in the record and stop before inventing
a schema. Do not add a table or a new manifest section on your own authority.

## Protocol

- Branch `fix/artifact-rendering-2026-10-23` in your own worktree from
  `origin/master`. The shared checkout carries another thread's uncommitted work.
- Fresh worktree: `npm ci` (about 2 min) or symlink
  `/home/deploy/repos/bb-plugin-stelow/node_modules`; delete the symlink before
  committing. An incomplete install gives a fake `Cannot find module 'pele'` at
  `server/runtime/platform.ts:145` - that is the install, not your change.
- **Red proof for each defect**, with the assertion text captured: revert the fix
  (or stub it) and show the test failing on the old behaviour.
- Gates, all three, with exit codes in the record: `npm run --silent typecheck`,
  `npm run --silent quality:shape`, `npm test`. Budgets are hard: split behaviour,
  never compress a function or raise a ceiling. A `.mjs` imported from TypeScript
  needs its `.d.mts` updated in the same commit.
- Record at `docs/audits/2026-10-23-artifact-rendering-record.md`: the defect with
  path:line, what changed, the red proof, the exits, and a final section "what I
  did not do and why".
- Never push, merge, tag or release. Never edit `skills/` or `data/stelow` by hand.

## Report

Under 250 words: the two root causes (one line each, with the file that is now the
single owner), the red proofs, the three exit codes, what needs a product decision,
and the one thing a human should look at first.
