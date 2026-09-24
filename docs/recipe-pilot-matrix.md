# Recipe pilot and validation matrix

Compiled on 2026-09-23 and live-probed on 2026-09-24 against BB 0.43.3 in
the active plugin worktree.
The machine-readable record is
[`tests/fixtures/recipe-pilot-matrix.json`](../tests/fixtures/recipe-pilot-matrix.json),
and `tests/recipe-pilot-matrix.test.mjs` re-checks it against the generated
catalog and the production route and artifact validators.

## What the probes prove

Each rendered recipe was passed to the real host compiler with:

```bash
bb workflows validate --script <rendered-recipe-source> --json
```

All 12 generated sources returned `valid: true` with no failures. This is a
host-validation result, not an agent-execution claim. The matrix test pins the
SHA-256 of the source and generated catalogs, workflow renderer, route policy,
native capability report, and artifact validator. A change to any of those
inputs makes the test fail until the matrix is revalidated.

A separate live probe, `wfr_71c80819-04e9-4903-b230-e140747076d8`, validated and
ran a direct two-worker artifact-only Workflow. Both agent calls succeeded,
their execution windows overlapped, and each wrote a separate non-empty receipt
under the probe's thread-storage artifact root. The workspace status hash was
unchanged before and after. This completes the direct BB fan-out capability
evidence; it does not prove that a Stelow renderer dispatches its tasks. The
worker threads `thr_nr4mgc8znh` and `thr_zci3dtbpss` also report
`originPluginId: "workflows"`, `visibility: "hidden"`, a lifecycle owner, and
archived state after completion, which completes the direct hidden-worker
capability evidence.

The production-renderer probes exposed and then isolated a schema-subset
compatibility defect. The earlier runs `wfr_f8b32f88-5408-4f2d-a441-03a0df5b162c`
and `wfr_d82b2778-3a66-4d2d-8489-17f1712a0f6b` were false positives: they
reported success with zero calls, empty outputs, and no artifacts because the
rendered task schema included `$schema`, which BB's safe workflow subset rejects.
The renderer now removes schema metadata recursively before passing task schemas
to `agent()`. It also keeps the output-path instruction inside a valid string
literal; the earlier generated source used nested double quotes there, which
the safe workflow parser surfaced as a leading `NaN` in worker prompts. The
focused regression tests prove both properties, and the matrix now compares
every recorded `source_sha256` with the current renderer output instead of
checking only hexadecimal shape.

A sanitized `execution-audit` rerun,
`wfr_961d3615-f28e-4a92-ad04-f94d4f086cb8`, then dispatched both root tasks and
the join task: it recorded three successful calls and returned all three
structured outputs. The corrected post-fix pilot
`wfr_0089d253-fecc-4b2a-8162-84f512ace334` also completed with three
successful calls. Its worker prompts contained no `NaN` prefix, and all three
declared artifacts were present and non-empty under the pilot artifact root:

- `audit/requirements.md` — 9,089 bytes;
- `audit/evidence.md` — 8,147 bytes;
- `audit/report.md` — 12,657 bytes.

The run used host thread storage rather than the production card receipt path,
so artifact registration through `.registered.json`, partial-failure handling,
and lifecycle evidence remain open.

The contract probe then exercises every recipe without workspace writes:

- every task id, dependency, condition, capability, and output path is checked;
- dependency graphs must be acyclic and every output must stay inside the
  artifact root;
- a schema-derived positive artifact set must pass for every declared output;
- every output must fail when omitted or blank;
- every JSON output must fail when malformed or schema-invalid;
- artifact-only recipes must resolve to the native route with the current host
  capability report;
- fallback preservation, failure policies, inherited permissions, and human
  boundaries are recorded per recipe.

The matrix also found and fixed one contract defect: artifact validation
returned the unconditional output list in its `paths` field even when recipe
conditions activated an additional output. The validator now returns the
context-sensitive required paths. This strengthens the guard; it does not relax
it.

## Matrix

| Recipe | Write policy | Recorded route | Real/contract probe | Failure | Human wait | Verdict |
|---|---|---|---|---|---|---|
| `codebase-critique` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `execution-audit` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `interface-alternatives` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `plan-critique` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `planning-research` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `scope-batch` | workspace | coordinator-sequential | host validation + artifact contract only | fail | `gap-escalation` | native fan-out waived |
| `setup-recon` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `shape-recon` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `strategic-context` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `testing-strategy` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `ux-critique` | artifact | native | host validation + positive/negative artifact contract | fail | none | validated, not executed |
| `verification` | artifact | native | host validation + positive/negative artifact contract | fail; UI task may skip with reason | none | validated, not executed |

All recipes inherit the origin permission profile. The `verification` UI task
is conditional on UI scope and uses the catalog's explicit
`skip-with-reason` policy; the matrix activates it with a complete context and
also checks the declared failure policy rather than silently dropping it.

## Contextual waiver: `scope-batch`

No native `scope-batch` pilot was simulated or claimed. The recipe is
workspace-writing, and the current host does not prove all of the following:
file-claim ownership, isolated workers, transitive partition safety, parent
merge, parent verification, cleanup, and retry behavior.

The required route therefore remains `coordinator-sequential`, even if a caller
claims every native capability. The fallback preserves artifacts, claims, and
parent verification. Native fan-out stays disabled until the missing safety
evidence exists. The host compiler acceptance and artifact-contract checks are
recorded only as validation evidence; they are not a native fan-out pilot.

## Capability boundary probes

The execution tests pin the route and adapter boundary. The direct live run
supplies host evidence for `fanout`: BB ran two independent structured workers
and returned both results. The sanitized production-renderer run above adds
separate evidence that the generated task graph dispatches and joins. BB still
reports `file-claims` and `isolated-workspace` as `false`. An artifact recipe
may select the native route only when its write policy is `artifact` and every
required capability is present; that selection still does not prove artifact
registration, partial-failure handling, or lifecycle reconciliation. A missing
capability routes to `coordinator-sequential`, or to `refused` when the recipe's
fallback explicitly refuses. Unknown capability names, malformed capability
containers, and non-boolean capability claims fail closed even when a caller
supplies a truthy value for them.

The workspace writer and `scope-batch` are checked with an all-true capability
report as a negative probe: they must still remain coordinator-sequential. The
probe never invokes an agent and does not enable workspace fan-out. Native
workspace fan-out remains blocked until file claims, isolation, parent merge,
and parent verification are real, tested capabilities.

## Reproduction

From the plugin worktree:

```bash
node tests/recipe-pilot-matrix.test.mjs
npm run typecheck
```

The matrix test is deterministic and does not start agents, write workspace
files, or depend on a service restart. The real host-validation evidence and
its exact source hashes are preserved in the fixture. The 2026-09-24 live
evidence is identified by the run IDs above; the command above checks route and
artifact contracts only and must not be reported as another execution pilot.
