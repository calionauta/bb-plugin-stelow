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

## Rule for new decision sites

Before adding a model call for a classification:

1. prove that deterministic rules cannot answer it safely;
2. register a named decision point and its question schema;
3. use the configured Decision API when available;
4. use a preset only when the point is low-frequency and a judge preset is explicitly configured;
5. otherwise use deterministic rules or pause with a human-readable question;
6. record the route, confidence, and fallback in the card trail.

This keeps cheap classification out of full worker turns while preserving the existing human gates and evidence-based lifecycle guarantees.
