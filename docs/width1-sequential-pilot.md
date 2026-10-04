# Width-1 sequential pilot

## Goal

Decide with runtime evidence whether artifact recipes with effective
width 1 should default to coordinator-sequential instead of native
workflows. Spike 2026-10-04 (`docs/native-workflows.md`) timed one native
width-1 run at 63s wall for 1 artifact (`wfr_e46d5042`) against one native
width-2 run at 147s wall for 3 artifacts (`wfr_48503120`): per-run fixed
cost (threads, polls, ledger, up-to-45s reconcile detection lag) amortizes
with fan-out and is pure overhead at width 1. The spike is n=1 per arm on
different tasks, so it motivates this pilot but decides nothing.

## Scope (narrow on purpose)

- Only the three single-task stage recipes: `setup-recon`, `shape-recon`,
  `scope-map`. Linear chains, `testing-strategy` (supporting, not
  stage-bound), `scope-batch`, workspace writers, and coordinator human
  boundaries are out: the first two need their own measurement, the rest
  already have a decided route.
- Width is static (default context). Context-plumbed width (RouteContext
  from `state.md` knobs) is a separate follow-up, not this pilot.

## Mechanism (mirrors the scope-batch pilot pattern)

- `WIDTH1_SEQUENTIAL_PILOT_ALLOWED = false` default in `lib/` next to
  `NATIVE_SCOPE_BATCH_PILOT_ALLOWED`; one-flag rollback.
- `evaluateWidth1Pilot({ recipe, width, allowed })` returns
  `{ mode, gates: { flag, artifact, width }, reason }`:
  - `artifact` requires `write_policy === "artifact"`;
  - `width` requires static effective width <= 1 (`lib/recipe-width.mjs`);
  - any gate failure keeps the current native route (never a partial flip).
- The router consults it only when the base decision is native, so
  `resolveExecutionRoute` and the recipe matrix stay green unchanged.
- Behavior tests per gate (flag off stays native, workspace never
  pilot-eligible, width >= 2 stays native), each failing if its guard is
  removed.

## How this pilot actually runs (no fleet telemetry)

Three facts constrain the design: measurements live only in each
install's local BB database, the author never sees other installs' data,
and there is no telemetry channel (building one is disproportionate and
privacy-sensitive). So this pilot does NOT depend on fleet statistics.
It depends on four things that actually exist: the static cost model
(counted ops, already in repo), the spike timings (63s width-1 vs 147s
width-2), author dogfood with a timebox, and a verdict written in this
doc. Fleet statistics (N-per-arm with blind spot-checks) remain the
fallback only if dogfood disagrees with itself.

## Dogfood protocol (the real measurement)

1. Enable the flag on the author's own workspace only.
2. Work normally for 6 weeks (aim: 5+ cards crossing
   `setup`/`shape`/`scope`), verdict written here by 2026-11-15.
3. Per card, record: did any stage feel slower than native memory, any
   missing/malformed artifact, any extra question or retry the stage
   needed.
4. Native baseline from the author's own BB database (`execution_runs`):

```sql
SELECT recipe_id, COUNT(*),
  AVG((completed_at - started_at) / 1000.0) AS avg_s,
  SUM(normalized_status = 'succeeded') AS succeeded
FROM execution_runs
WHERE adapter = 'bb-workflows'
  AND recipe_id IN ('setup-recon', 'shape-recon', 'scope-map')
  AND normalized_status IN ('succeeded', 'failed')
GROUP BY recipe_id;
```

No silent expiry: on the date, one of flip-default / keep-native /
extend-once is written here.

## Escape hatch (why a later flip is safe to ship)

No default flip ships without a per-project opt-out (force native) plus
a release-notes entry. Installs never watch measurements; bad outcomes
are reversible per install with no author data involved.

## Decision rule (dogfood version)

Flip iff dogfood shows no slower-feeling stage AND no new
artifact/retry incidents versus the native baseline AND ledger averages
do not regress. Otherwise keep native: keeping native on evidence is a
valid outcome, converting today's assumption into a measured status quo.

## Verdict (2026-10-04): keep the native default, pilot closed

No flag is implemented, no dogfood runs, no follow-up decision exists.
The width-1 default stays native because the gain is unmeasured
efficiency (tens of seconds per stage) while the losses are structural
(per-task schema validation, durable resume, run UI, isolation) with no
fleet telemetry to detect regret — and this plugin ships no telemetry by
design. Multi-scope work is unaffected: `scope-batch` (workspace writes)
routes coordinator-sequential before any of this is consulted. Production
quality is unchanged: every artifact recipe keeps native validation where
eligible, and the shipped guards (context overlay, probe cache,
ledger-first sweep, sequential checklist) all fail closed to current
behavior with pin tests. Reopen only with measured evidence under the
dogfood protocol above, never by default drift.

## What this pilot can and cannot prove

- Can: latency, acceptance, and cost deltas at width 1 under current
  models — enough to implement or reject the default flip.
- Cannot: artifact quality equivalence (add a blind spot-check rubric on
  a subsample if quality is contested), rare failure modes (needs larger
  N), or cost generalization across model changes (re-run the metric,
  not the whole pilot, when models move).
- Dogfood cards are not randomized; report arm composition alongside
  every number.
