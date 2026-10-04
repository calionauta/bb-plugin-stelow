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
trail; width 1 stays native pending live evidence. `scope-batch` stays
coordinator-sequential except the disjoint-scopes-with-satisfied-claims
pilot; any gate failure falls back with no partial fan-out
(`native_pilot_allowed=false` rolls back with no code change).
