export const meta = {
  name: "stelow-validate-native-fanout",
  description: "Validate BB native fanout for safe recipes and prove why workspace scope-batch remains fail-closed",
  phases: [{ title: "Capability Probe" }, { title: "Safety Tests" }, { title: "Resolution" }],
}

const safety = "Do not commit, push, reset, clean, or restart services. Do not edit app.tsx. Do not enable workspace fan-out or claim file claims that do not exist. Use real workflow validation/probes only for safe artifact recipes."

phase("Capability Probe")
const probe = await agent(
  "Read lib/bb-workflow-capabilities.mjs, server/bb-workflow-bridge.ts, server/bb-workflow-adapter.ts, lib/execution-route.mjs, the generated recipe catalog, and the recipe pilot matrix. Run safe real BB workflow validation or probes for at least one artifact-only fanout recipe and one non-fanout recipe. Do not run a workspace-writing probe. Return exact observed capabilities, outputs, and whether the engine fanout is genuinely available. " + safety,
  { phase: "Capability Probe" },
)

phase("Safety Tests")
const tests = await agent(
  "Add or strengthen behavior tests in the active plugin for native fanout selection: fanout=true is visible, artifact recipes can use it, workspace recipes route coordinator-sequential, scope-batch is always refused natively, and file-claims/isolated-workspace=false remain explicit blockers. Do not weaken the adapter or route tests. Run focused tests and typecheck. " + safety,
  { phase: "Safety Tests" },
)

phase("Resolution")
const resolution = await agent(
  "Review the probe and tests. Update docs/staged-execution-continuity.md and docs/recipe-pilot-matrix.md only with evidence. If safe artifact fanout is proven, record it as completed capability evidence. Keep workspace scope-batch deferred and fail-closed. Return the exact remaining release blockers. " + safety,
  { phase: "Resolution" },
)

return { state: "succeeded", probe, tests, resolution }
