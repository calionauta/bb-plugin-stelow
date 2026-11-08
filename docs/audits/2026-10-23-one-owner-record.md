# One owner: the gap schema and the artifact count

**Type:** fix record. **Branch:** `fix/one-owner-2026-10-23` (own worktree, from
`origin/master`). Two facts had several owners and each owner believed itself.
In both, the fix names one owner, derives the rest from it, and adds the test
that fails when they separate again.

## Defect A — the gap registry had two schemas

### Who owns it

`lib/gap-registry.mjs` is the single reader of the `gaps:` frontmatter:
`parseGapFrontmatter` parses, `validateGapRegistry` refuses. Everything else
consumes its rows — `server/runtime/critique-gap-state.ts` types a **subset** of
the row it returns (`description`, `resolution`, `evidence`, `expires`,
`owner`), which is a view, not a second schema, so it stayed untouched.

The skill was right and the parser was wrong. `skills/stelow-workflow-execution-critique/references/workflow-audit.md`
(the Gap Registry section) documents the registry with inline YAML annotations
on every field:

```yaml
  - type: missing-tests          # missing-tests | incomplete | quality | new-scope | debt
    impact: medium               # low | medium | high | critical
    effort: moderate             # optional — trivial | moderate | significant. …
    expires: null                # documented debt only: YYYY-MM-DD + owner below.
    evidence:                    # optional — measurements behind the verdict…
```

That is valid YAML: a `#` that starts a token opens a comment. The parser kept
the comment as part of the value, so a worker who copied the template verbatim
produced `impact = "medium               # low | medium | high | critical"`,
`evidence` was read as a scalar instead of a mapping, and `expires: null  # …`
would have failed the date check. Reproduced against HEAD: the skill's own
fenced template was refused with one `gap-incomplete-row`; the evidence and
expiry damage never even reached validation, because the row fails at the
impact/resolution check first.

**Chosen fix:** teach the parser to read YAML, not to rewrite the documentation
around the parser. `stripYamlComment` removes a trailing comment outside quotes
(`#` at the start of a value or after whitespace; literal inside `'…'`/`"…"`,
with `''` and `\"` escapes honoured) and `yamlScalar` applies it before
`stripQuotes` to every scalar the parser reads. Field names never changed: the
skill and the parser disagree on nothing now, and the parser remains the
authority for the shape.

### What would have caught it earlier

A test that parses the skill's **own** fenced example through the parser.
`tests/gap-registry.test.mjs` now extracts the ```yaml block containing
`gaps:` from `workflow-audit.md`, asserts `validateGapRegistry(template) === []`,
asserts the annotated fields parse as bare values (`missing-tests` / `medium` /
`moderate` / `escalate` and `incomplete` / `high` / `moderate` / `escalate`),
and asserts the documented `evidence:` block parses as a measurement mapping. A
second case pins the quote rule (`description: "fix #12 in the parser"` survives;
`impact: low  # severity` does not).

### Red proof (assertion text)

With the comment stripping removed, the test fails with exactly the refusal the
card saw:

```
AssertionError [ERR_ASSERTION]
  actual: [{
    code: 'gap-incomplete-row',
    expected: "gap #1 (What's missing or incomplete): impact low|medium|high|critical, resolution fixed|documented|escalate",
    found: "gap #1 (What's missing or incomplete): impact medium               # low | medium | high | critical, resolution escalate         # fixed | documented | escalate",
    detail: "gap #1 (What's missing or incomplete) needs impact and resolution — found impact medium …"
  }]
  expected: []
```

Restored, the same file passes: `gap registry test ok: parse, misclassification
gate, contract wiring`.

### The synced skill may be overwritten — what to do

`skills/` syncs from upstream and is overwritten without warning. This change
does **not** edit it: the template was already correct. If a future sync brings
a template whose fields the parser cannot read, `tests/gap-registry.test.mjs`
turns CI red on the template itself, naming the field. The repair is then either
the parser (when the template is valid YAML, as here) or the template **upstream
in `calionauta/stelow`**, followed by a sync — never a local hand-edit of
`skills/`, which the next sync deletes.

## Defect B — three artifact counts, one of them durable

### Who owns it

The `artifacts:` list in `state.md`, read by `parseArtifactManifest`
(`lib/artifact-manifest.mjs`). No new counter was added. The three surfaces are
derivations, and the derivation now goes through that one list:

- `bb stelow manifest` — already read the list (unchanged).
- `bb stelow export` / `done` trailer — **was** derived from the files the
  exporter managed to copy. Now derived from the registration.
- the trailer embedded in `docs/runs/<card>/manifest.md` — same correction; the
  bundle's `## Files` table remains what this export copied, and the manifest
  states both numbers in one line: ``N registered in `state.md` (M copied)``.

Two code changes, because there were two lies under one symptom:

1. `renderBundleManifest` takes `registered` and builds the trailer from it;
   `cli-bundle-writer.ts` builds its trailer from `sources.registered`, so
   `export`, `done`, and the embedded trailer are the same number as `manifest`.
2. `writeBundleFiles` handed `assignBundleNames` entries carrying `sourcePath`
   while that function reads `path` — every entry read as junk, so **every**
   bundle copied zero files while still printing a trailer. Fixed by naming the
   translation (`{ stage, path: entry.sourcePath }`). This is why the committed
   bundles under `docs/runs/` carry `Stelow-Artifacts: 0` next to a `## Missing`
   list of seventeen registered artifacts.

`doneStdout` / export output no longer say "No registered artifacts — nothing to
bundle" when the registration is non-empty and nothing could be read: they print
the trailer and say what is true ("3 registered in state.md, none copied"). The
trailer's count is read back with `trailerArtifactCount` rather than re-derived,
so a surface that phrases the skip cannot disagree with the number the worker
pastes.

### The delta, named rather than equalised

`state.md` can declare more rows than the count. Declared rows are input, not a
fourth number: a repeated `path` is one artifact (two rows, one file), and a row
without a path names nothing this host can read, list, or copy. The reported
31-row / 24-artifact card is consistent with that delta (seven rows either
duplicated a path or named no path); the card's `state.md` is not in this
repository, so that is the mechanism, not a re-derived count. Changing
`parseArtifactManifest`'s definition of an artifact would move the card, board,
and bundle at once, so it was left alone and the delta is asserted instead.
`tests/artifact-count-owner.test.mjs` proves it: 4 declared rows naming 2
artifacts (one duplicate path, one row with no path) count as 2.

### Tests and red proofs

`tests/artifact-count-owner.test.mjs`, one fixture card: 3 registered artifacts,
2 readable.

1. `bb stelow manifest`, the `export` output, and the written
   `docs/runs/<card>/manifest.md` all read `Stelow-Artifacts: 3`; the manifest
   also says `(2 copied)` and lists the unreadable path under `## Missing`.
2. **Remove one artifact from `state.md` and both derived numbers drop by
   exactly one** (`manifest` and the trailer) — a number that does not move is
   not derived from the owner.
3. The declared-rows delta above.

Observed failures before the fix:

- trailer derived from the copied subset:
  `AssertionError [ERR_ASSERTION]: the export trailer counts what state.md registers — 0 !== 3`
- `assignBundleNames` fed the wrong key:
  `AssertionError [ERR_ASSERTION]: while the manifest still says how many of them this export actually copied — two different facts, each named`

After the fix: `artifact count owner test ok: trailer and manifest derive from
state.md, and both move with it`.

### What would have caught it earlier

An assertion that the two derivations are equal for a fixture card, plus one that
the bundle copies what it registers — the second is what `FEATURES.md` already
claimed ("copies the registered artifacts into flat `docs/runs/<card>/`") and
nothing tested. Both now exist.

## Gates (exit codes)

| Gate | Exit | Output head |
|------|------|-------------|
| `npm run typecheck` | 0 | `tsc --noEmit` |
| `npm run quality:shape` | 0 | `source shape ok: 9 source file(s) … no changed line over 160 characters`; `writeBundle` 65 lines vs baseline 68 |
| `npm test` | 0 | full suite, `# fail 0` |

## What I did not do, and why

- **Did not edit `skills/`.** The template was correct; the parser was not. A
  synced tree is overwritten on the next sync anyway, and the new contract test
  is the durable guard.
- **Did not touch `server/runtime/critique-gap-state.ts`.** Its type is the
  output view of parsed rows, not an input schema; changing it would create the
  second schema this defect was about.
- **Did not add a "declared rows" counter.** That is a third owner. The delta is
  named in prose and pinned in the test.
- **Did not rewrite the committed `docs/runs/*/manifest.md` records** that carry
  `Stelow-Artifacts: 0`. They are evidence of what the buggy code emitted;
  rewriting history would erase the proof.
- **Did not change what counts as an artifact** in `parseArtifactManifest`
  (requires `stage` + `path`, dedupes by `path`). That definition is read by the
  card, the board, and the bundle at once — a separate change with its own
  evidence.
- **Did not change the gap registry's failure codes or wording.** The refusal
  text that misled three documents (`needs depth — … gaps: frontmatter
  registry`) is unchanged; what changed is that following the documentation no
  longer produces it.
- No dependency added, no UI touched, nothing pushed, merged, tagged, or
  released.
