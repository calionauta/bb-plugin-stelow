# Native BB Workflows integration

User documentation (canonical):
https://calionauta.github.io/stelow/docs/plugin/native-workflows/

Operator summary: eligible recipes run through the host `workflows`
plugin (`bb workflows run`, runId in the execution ledger); the router
picks the narrowest safe mode per recipe. `scope-batch` stays
coordinator-sequential except the disjoint-scopes-with-satisfied-claims
pilot; any gate failure falls back with no partial fan-out
(`native_pilot_allowed=false` rolls back with no code change).
