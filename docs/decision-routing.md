# Decision routing policy

Stelow separates deterministic workflow policy from semantic classification. A stage transition, completion gate, or human-question requirement must never be delegated to a model when the contract can be checked from state, artifacts, receipts, dependencies, or claims.

When a decision is genuinely semantic or classificatory, the preferred order is:

```text
deterministic rules → configured Decision API/router → configured preset fallback
```

The Decision API is the shared Jev-compatible client in `lib/decision-api.mjs`. Each point is declared in `lib/decision-points.mjs`, with its questions, mode, threshold, and route. The supported modes are:

- `rules`: deterministic host policy;
- `api`: the configured Jev-compatible decision provider;
- `preset`: an explicitly configured low-frequency judge preset.

Unknown modes, missing routes, low confidence, timeouts, malformed answers, and disabled API configuration degrade to the point's built-in rules. They never silently spawn an unconfigured LLM.

## Registered points today

- `triage-intent`: advisory classification of the initial Build intent;
- `artifact-criteria`: semantic criterion scoring for explicit artifact checks;
- `auto-continue`: a veto for idle-worker continuation;
- `inbox-severity`: advisory promotion of routine inbox items.

These points are centralized so the UI, persistence, thresholds, and call sites share one contract.

Two read-only CLI commands judge through the `artifact-criteria` point rather than registering their own: `bb stelow verify-tasks` (one atomic Score per completed task against the working diff, after deterministic per-task verify commands run first) and `bb stelow gap-triage` (one atomic Score per escalated gap for genuineness, against the critique plus the working diff). Both degrade to `unverifiable` below the point floor, and neither gates anything — deterministic verify output and the gap impact×effort matrix stay authoritative.

## Current gaps and exceptions

The policy is not yet applied uniformly to every model-assisted judgment. The known exceptions are:

- gate pre-review still creates a configured review thread because it is a broad semantic artifact review, not a small classifier;
- interface selection remains a worker responsibility when the selected-interface contract allows automatic selection;
- worker prompts can still ask a model to interpret prose or choose an approach when no deterministic contract exists.

Those paths are candidates for future named decision points, but they must not be migrated blindly. Each needs a bounded question schema, confidence policy, fallback behavior, tests against real artifacts, and a refusal/redirect when confidence is insufficient.

## Reading the threshold

`routeAt` is one stored number per point, and its direction is **not** uniform
across points. Each point's own wording ships in its registry entry
(`thresholdLabel`) and is what the settings slider shows, because a single
shared label would misdescribe at least one point.

- `artifact-criteria`, `inbox-severity`, `triage-intent` — a floor on the
  confidence needed to **act** on the model's answer. Raising it makes the host
  act less.
- `auto-continue` — a floor on the confidence that a turn **did** make progress.
  The action is the veto, so raising it makes the veto fire more often and the
  worker spend fewer turns. This is the only inverted point, and it is
  deliberate: a worker turn is the expensive resource, so the bar for spending
  one should be high.

The asymmetry is the reason no point shares a threshold with a different
direction. If a future point's action is neither "act on the answer" nor "veto
it", give it its own key rather than reusing `routeAt` with new semantics.

## Known debt

Recorded here so the next pass does not rediscover them as if they were new
findings. None of these has a bounded question schema plus real-traffic
evidence yet, which is the bar this document sets for adding a point.

**No router point sits at a stage transition or artifact acceptance.** All four
registered points are at the edges: card creation, idle resume, the inbox tick,
and explicit CLI calls. Every stage advance and every artifact acceptance is
either decided deterministically or delegated to a full worker turn — and the
worker turn is the cost the router exists to avoid. This is the largest
unclaimed win, and it is deliberately unmigrated: a seam there needs at least
one named point with a real question behind it, not a place to hang a future
call.

**Three candidates were measured and rejected** (2026-09-28, against the live
card corpus rather than by inspection):

- *ask necessity* — the ask corpus is 45 rows over 16 days, and it is not a
  usable calibration set for this. Its largest cluster is 9 "request is empty"
  asks, but those split across two very different populations: 6 come from
  audit-harness cards (`REALSCN-…`, `AUDIT-NEEDS-INPUT-…`, `E2E audit …`) that
  were built to ask, and 3 come from real feature cards where a truncated title
  left the body empty. One cluster, two opposite correct answers — a classifier
  fit on it would learn the harness, not the product. And it sits on the
  product-authority path, where a wrong refusal is unrecoverable.
- *scope-map challenge* — `scope-map-challenge.json` has no host consumer
  today. A decision point with nothing reading its answer is advisory theater.
  The artifact is validated; nothing acts on it.
- *interface selection support* — there is real evidence (a card asked the
  interface gate, then asked the same direction again as a "selection record"),
  but the duplication is deterministic and answerable from the receipt already
  on disk. A rule beats a model call, and costs nothing to re-run.

If any of these becomes worth building, the bar is unchanged: prove
deterministic rules cannot answer it, then register a point with a bounded
schema, a confidence policy, a fallback, tests against real artifacts, and a
refusal when confidence is insufficient.

## Rule for new decision sites

Before adding a model call for a classification:

1. prove that deterministic rules cannot answer it safely;
2. register a named decision point and its question schema;
3. use the configured Decision API when available;
4. use a preset only when the point is low-frequency and a judge preset is explicitly configured;
5. otherwise use deterministic rules or pause with a human-readable question;
6. record the route, confidence, and fallback in the card trail.

This keeps cheap classification out of full worker turns while preserving the existing human gates and evidence-based lifecycle guarantees.
