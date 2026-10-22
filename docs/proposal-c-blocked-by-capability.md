# Proposal C: why it cannot be implemented as written, and what to do instead

Status: **blocked**, with a named path forward. Written after attempting it.

The recommendation in `docs/model-tier-economics.md` was: *declare the tail as
recipe tasks, so a per-task tier hint becomes a property of a declared task
instead of a second router.* The premise was that the mechanism already exists
and only a field was missing. It does not. Three separate constraints block it,
and the third one changes the conclusion.

## 1. The recipe catalog is sync-owned

`data/stelow-recipe-catalog.json` and `data/stelow-recipes.schema.json` are
copied verbatim from upstream by `lib/skills-sync-diff.mjs#SINGLE_FILES`:

```
repoPath: "skills/stelow-workflow-orchestrator/recipe-catalog.json"
localRel:  "data/stelow-recipe-catalog.json"
repoPath: "recipes.schema.json"
localRel:  "data/stelow-recipes.schema.json"
```

`AGENTS.md` is explicit: *"Never hand-edit `skills/` or `data/stelow` — both sync
from upstream and are overwritten without warning."* Adding a field to a task
here is a one-way edit: it works until the next sync deletes it, and the drift
gate reports a perfect match against a pin that never had it.

Adding a task-level tier requires an upstream change first — a `recipes.schema.json`
field, a `recipe-catalog.json` generator emission, an upstream release, and a
sync dispatch. That is a different repository's release cycle, not this commit.

## 2. The renderer has no override path, and the capability is `false`

`server/bb-workflow-bridge.ts` renders each task as:

```js
agent(prompt, { phase: "Execute", schema: task.outputSchema })
```

There is no model argument, because `lib/bb-workflow-capabilities.mjs` reports
`"per-call-model": false`. `docs/staged-execution-continuity.md` records this as
a **resolved negative capability**:

> `per-call-model` | Resolved negative capability | reports `false`; no current
> generated recipe requires it, and the renderer has no task-level model override
> path. | None while no recipe requires it; **a future requirement must remain
> blocked until support is implemented and behavior-tested**

So even a valid catalog field would be silently ignored by the renderer — a
setting that reads as configured and does nothing, which is the exact failure
class this codebase spends its tests on.

## 3. The tail does not need a model at all — it needs host commands

This is the finding that makes the blocker moot. Classifying the 434 post-artifact
tail commands by whether a deterministic host command could do the work:

| what it is | commands | share |
|---|---|---|
| file inspection (`ls`/`cat`/`grep`/`find`/`wc`) | 167 | 38.5% |
| a `bb stelow` gate verb | 111 | 25.6% |
| test run | 27 | 6.2% |
| git plumbing | 26 | 6.0% |
| inline deterministic script | 12 | 2.8% |
| shell composition | 9 | 2.1% |
| file copy/move | 6 | 1.4% |
| sqlite | 2 | 0.5% |
| bb cli one-liner | 1 | 0.2% |
| **subtotal deterministic** | **361** | **83.2%** |
| **needs a model** | **73** | **16.8%** |

**83% of the remaining tail needs no model.** Routing it to a cheaper tier would
still pay per token for work the host can do for free, and it would spend a
renderer capability that the project has deliberately refused.

The honest instrument for this tail is not a tier hint. It is a host subcommand
that answers the question directly — which is what the last two commits did for
paths, receipts, artifact registration and run listings, and what the remaining
two thirds still need (`bb stelow verify --tests`, `bb stelow audit-trail check`
already exist as verbs; the workers still wrap them in `grep`/`head` pipelines
and re-derive their output).

## What ships instead, and why it is the same idea

The per-task tier hint is a way to say *"this declared step is cheap"*. The
measurement says something stronger: **this step is free.** A step the host
executes deterministically is cheaper than any tier, and it needs no capability,
no upstream release, and no schema change.

So the recommendation stands in spirit and changes in instrument:

1. **Make the deterministic steps declared and host-executed**, not routed. The
   mechanism for that already exists and is not gated: `bb stelow <verb>` commands
   are the host's own surface, and the reconciler already runs host-side work
   (artifact registration, commit 29b7f6ae/ec65679c).
2. **Then, and only then, ask whether the remaining 16.8% needs a tier.** If it
   does, it needs the upstream catalog field plus a real `per-call-model`, and it
   is blocked by (1) and (2) above until both land.

## What is not being done, deliberately

- Not editing `data/stelow-recipes.schema.json` or the catalog. Sync would revert
  it and the drift gate would not notice, because the gate compares against the
  pin rather than against upstream `main`.
- Not flipping `per-call-model` to `true`. It is a resolution with named evidence
  requirements; a requirement that cannot be honoured must stay blocked rather
  than be downgraded silently.
- Not adding a tier hint the renderer ignores. A setting that does nothing is
  worse than one that does not exist.
