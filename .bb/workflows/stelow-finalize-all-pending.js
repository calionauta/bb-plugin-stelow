export const meta = {
  name: "stelow-finalize-all-pending",
  description: "Close the remaining Stelow execution-plan pendencies with safe implementation, explicit waivers, and validation evidence",
  phases: [
    { title: "Inventory" },
    { title: "Migration" },
    { title: "Deep Links" },
    { title: "Upstream Packaging" },
    { title: "Plan Closure" },
    { title: "Validate" },
  ],
}

const safety = "Do not commit, push, reset, clean, or restart any service. Preserve unrelated dirty work. Work only in the paths named in the task. If a requested change would weaken a safety guard, refuse it and record an explicit waiver instead."

phase("Inventory")
const inventory = await agent(
  "Read docs/staged-execution-continuity.md, both temporary plan files, current git status in /home/deploy/repos/stelow and the active BB worktree, and the latest validation outputs. Do not edit files. Produce an implementation inventory grouped into: safe code work, safe test-only work, upstream sync work, explicit waivers, and release blockers. " + safety,
  { phase: "Inventory" },
)

phase("Migration")
const migration = await agent(
  "Implement the missing persisted-card migration evidence for the active BB plugin worktree. Read the continuity document, workflow-state identity helpers, seed/lineage/card lifecycle tests, and current state templates. Add focused fixtures/tests for cold install, upgrade/legacy review modes, reopen, retry, archive, delete, and unknown old stage IDs. Make the smallest production change only if a test proves it is required. Do not touch execution routing, UI, or upstream skills. Run the focused migration tests. " + safety,
  { phase: "Migration" },
)

phase("Deep Links")
const deepLinks = await agent(
  "Implement the remaining run deep-link/deep-open product contract in the active BB plugin worktree. Read the execution ledger, run UI, status/result/cancel/resume paths, and FEATURES.md. Define and test the supported deep-link behavior for queued, running, needs_input, succeeded, failed, and cancelled states. Keep native run IDs and preview directives separate from in-app navigation; never invent a route for unsupported states. Update FEATURES.md if the user-visible contract changes. Run focused tests and typecheck. " + safety,
  { phase: "Deep Links" },
)

phase("Upstream Packaging")
const packaging = await agent(
  "Work only in /home/deploy/repos/stelow on the remaining 58-failure packaging/sync debt. Inspect the host-agnostic audit, skill-links, and no-clitools-copies tests plus the source of the duplicated cli-tools files. Apply the smallest upstream-safe fix that removes stale plannotator/intercom copies, repairs relative links, and removes physical duplicates without weakening the tests. Do not edit the BB plugin worktree. If the correct fix requires a sync-policy decision that cannot be made safely, stop and return an explicit waiver with exact files. Run the four affected test files. " + safety,
  { phase: "Upstream Packaging" },
)

phase("Plan Closure")
const closure = await agent(
  "Update docs/staged-execution-continuity.md in the active BB worktree with evidence from the migration, deep-link, and packaging phases. Also prepare, but do not apply, a concise completion/waiver addendum for the two temporary plan documents. Mark scope-batch native fan-out as deferred only if claims, isolation, parent merge, and parent verification remain unproven; never claim it is complete. Do not mark the plans complete while any required evidence is missing. " + safety,
  { phase: "Plan Closure" },
)

phase("Validate")
const validation = await agent(
  "Perform a read-only final validation of both repositories after the previous phases. Inspect git status, diff check, available test logs, and the continuity document. Run only safe focused checks if needed; do not commit or push. Return remaining blockers and whether each plan can be marked complete, partially complete, or explicitly waived. " + safety,
  { phase: "Validate" },
)

return {
  state: "succeeded",
  inventory,
  migration,
  deepLinks,
  packaging,
  closure,
  validation,
}
