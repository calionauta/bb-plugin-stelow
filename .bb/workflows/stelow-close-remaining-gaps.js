export const meta = {
  name: "stelow-close-remaining-gaps",
  description: "Turn the remaining Stelow execution-plan gaps into an ordered, evidence-backed implementation plan",
  phases: [{ title: "Audit" }, { title: "Plan" }],
}

phase("Audit")
const reports = await parallel([
  () => agent(
    "Read docs/staged-execution-continuity.md, lib/execution-adapter.mjs, server/bb-workflow-adapter.ts, server.ts, and the native execution tests. Focus only on the remaining fallback contract. Do not edit files. Decide whether the canonical safe behavior should be explicit refusal plus coordinator-sequential execution or a real selectable sequential adapter. Return a concrete contract, exact files/symbols, tests, and migration risks.",
    { phase: "Audit" },
  ),
  () => agent(
    "Read docs/staged-execution-continuity.md, the plugin state/lineage/seed tests, workflow-state identity helpers, stage catalog loader, and the current state templates. Do not edit files. Design the missing persisted-card migration test matrix for cold install, upgrade, reopen, retry, archive, delete, legacy review modes, and unknown old stages. Return fixtures, assertions, and any production code changes required.",
    { phase: "Audit" },
  ),
  () => agent(
    "Read the two temporary plans, the recipe catalog, execution ledger, workflow bridge, and existing live-probe evidence. Do not edit files. Build a recipe pilot/validation matrix for all low-risk recipes, identify which can be tested without workspace writes, and define evidence required before enabling each one.",
    { phase: "Audit" },
  ),
  () => agent(
    "Read the latest upstream test output and the skill packaging/sync code. Do not edit files. Confirm the 58-failure baseline attribution and propose the smallest separate remediation for cli-tools copies, plannotator/intercom host leakage, relative links, and absolute skills/... links. Keep execution-plan files out of scope.",
    { phase: "Audit" },
  ),
  () => agent(
    "Read the execution ledger, run UI, status/result/cancel/resume paths, and FEATURES.md. Do not edit files. Define the deep-link/deep-open product contract and test matrix for queued, running, needs_input, succeeded, failed, and cancelled runs. Distinguish BB preview directives from navigable in-app routes.",
    { phase: "Audit" },
  ),
])

phase("Plan")
const plan = await agent(
  "Synthesize the reports below into an ordered implementation plan. Be conservative and evidence-based. Separate code changes, test fixtures, documentation updates, and explicit waivers. Do not edit files. Return: immediate_blockers, ordered_tasks with dependencies, files_to_change, tests_to_add, acceptance_criteria, and what must remain deferred.\\n\\nREPORTS:\\n" +
    JSON.stringify(reports),
  { phase: "Plan" },
)

return { state: "succeeded", reports, plan }
