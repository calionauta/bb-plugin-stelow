# Decision routing policy

User documentation (canonical):
https://calionauta.github.io/stelow/docs/plugin/decision-routing/

Operator summary: deterministic rules first, then the configured Decision
API (`simplejev` default: keyless and deterministic, which is what a gate
needs; `classifier.dev` is Choice-only and cannot gate ambiguous cases;
`jev` needs a key and buys accuracy; per-point provider pins exist, so no
global default change is needed), then a preset fallback — never a
silently spawned unconfigured LLM.
Six registered points (`triage-intent`, `artifact-criteria`,
`auto-continue`, `inbox-severity`, `retry-transient`, `preset-tier`);
no point sits at a stage transition or artifact acceptance. `preset-tier`
is shadow-only: it records hint agreement and never overrides a preset.
Question kinds per point are registry metadata: api-mode saves with an
explicit labels-schema pin on a yes/no or scored point refuse with both
exits, and the picker derives which points each schema serves.
