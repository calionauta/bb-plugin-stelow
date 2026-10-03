# Decision routing policy

User documentation (canonical):
https://calionauta.github.io/stelow/docs/plugin/decision-routing/

Operator summary: deterministic rules first, then the configured Decision
API (`simplejev` default; `classifier.dev` cannot gate; `jev` needs a
key), then a preset fallback — never a silently spawned unconfigured LLM.
Four registered points (`triage-intent`, `artifact-criteria`,
`auto-continue`, `inbox-severity`); no point sits at a stage transition or
artifact acceptance.
