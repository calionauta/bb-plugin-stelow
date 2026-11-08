# Native BB Workflows integration

User documentation (canonical):
https://calionauta.github.io/stelow/docs/plugin/native-workflows/

Operator summary: eligible recipes run through the host `workflows`
plugin (`bb workflows run`, runId in the execution ledger); the router
picks the narrowest safe mode per recipe. Free checks (write policy,
capabilities, coordinator thread) run before the two-call availability
probe, probe results cache per thread for 60s, and the sweep skips cards
that already own their stage run. A native decision then passes a context
overlay: zero runnable tasks or a coordinator human boundary (live
needs-input cycle unproven) fall back with the width/boundary in the card
trail; width 1 stays native pending live evidence. Spike 2026-10-04:
setup-recon (width 1) ran natively in 63s wall for 1 artifact
(wfr_e46d5042); planning-research (width 2, 3 tasks) in 147s wall for 3
artifacts (wfr_48503120); acceptance 1s in both, so per-run fixed cost
(threads, polls, ledger) amortizes with fan-out and is pure overhead at
width 1. `scope-batch` stays
coordinator-sequential except the disjoint-scopes-with-satisfied-claims
pilot; any gate failure falls back with no partial fan-out
(`native_pilot_allowed=false` rolls back with no code change).
