export const meta = {
  name: "stelow-close-capability-waivers",
  description: "Test and resolve capability blockers with evidence, keeping unsafe scope-batch behavior fail-closed",
  phases: [{ title: "Audit" }, { title: "Behavior Tests" }, { title: "Decision" }],
}

const safety = "Do not commit, push, reset, clean, or restart services. Do not weaken a safety guard. Do not enable workspace fan-out without real file claims, isolation, parent merge, and parent verification. You may edit only the active plugin tests/docs and capability library; do not edit app.tsx or any upstream skill copy."

phase("Audit")
const audit = await agent(
  "Read docs/staged-execution-continuity.md, lib/bb-workflow-capabilities.mjs, lib/execution-route.mjs, lib/execution-adapter.mjs, recipes/scope-batch.yaml, the recipe catalog, server/bb-workflow-adapter.ts, and existing execution tests. Audit every B-SCOPE-1, B-PILOTS-1, and B-PIN-1 capability claim. Determine which parts can be resolved with real tests in this host and which must remain explicit waivers. Do not edit app.tsx. " + safety,
  { phase: "Audit" },
)

phase("Behavior Tests")
const tests = await agent(
  "Add or strengthen behavior tests in the active plugin worktree for the capability and waiver boundaries: BB reports fanout=true but file-claims=false and isolated-workspace=false; artifact recipes may use native fanout only when their write policy is safe; workspace and scope-batch never enter native fanout; missing capabilities route to coordinator-sequential or refusal; unsupported capability claims fail closed. Do not fake agent execution or weaken the capability map. Run the new tests and the execution contract suite. " + safety,
  { phase: "Behavior Tests" },
)

phase("Decision")
const decision = await agent(
  "Review the tests and current code. Update docs/staged-execution-continuity.md with an evidence-based capability disposition table. Resolve any capability item that is genuinely proven; keep the rest as named waivers with exact reasons and release blockers. Do not claim native scope-batch is complete. " + safety,
  { phase: "Decision" },
)

return { state: "succeeded", audit, tests, decision }
