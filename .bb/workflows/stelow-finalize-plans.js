export const meta = {
  name: "stelow-finalize-plans",
  description: "Resolve the remaining Stelow gaps, apply explicit contextual waivers, and close both execution plans with evidence",
  phases: [
    { title: "Context" },
    { title: "Upstream Reconciliation" },
    { title: "Pilot Matrix" },
    { title: "Plan Closure" },
    { title: "Validation" },
  ],
}

const safety = "Do not commit, push, reset, clean, or restart services. Preserve unrelated dirty work. Never weaken a guard to make a test pass. If a requested capability is unsafe or impossible in the current host, record an explicit contextual waiver instead of simulating it."

phase("Context")
const context = await agent(
  "Read docs/staged-execution-continuity.md, both temporary plan files, current git status/diff in /home/deploy/repos/stelow and the active BB plugin worktree, and the latest full validation results. Do not edit files. Decide the best contextual closure policy for: native scope-batch fan-out, synthetic sequential adapter, native deep links, upstream origin/pin reconciliation, and the 33 unchecked all-stages DoD items. Return a closure decision matrix with evidence, waivers, and exact files that may be edited. " + safety,
  { phase: "Context" },
)

phase("Upstream Reconciliation")
const upstream = await agent(
  "Work only in /home/deploy/repos/stelow. Compare the dirty checkout with origin/main and preserve every intentional execution-plan change. Reconcile only origin changes that are missing locally (version, changelog, coding standards, or other non-conflicting upstream commits). Do not pull/reset/clean. Produce a release-candidate manifest of local changes and explicitly state whether an immutable upstream commit/pin can be created without committing. Remove no safety guard. Run typecheck, verify:execution, the four packaging tests, and the full test suite. Return changed files, test results, and the exact remaining pin blocker. " + safety,
  { phase: "Upstream Reconciliation" },
)

phase("Pilot Matrix")
const pilots = await agent(
  "Work only in the active BB plugin worktree. Build a deterministic recipe pilot/validation matrix for every low-risk recipe using the generated recipe catalog and existing tests. For recipes that can be safely exercised without workspace writes, run the strongest available real/contract probe and record evidence. For workspace-writing scope-batch, do not fake a native pilot: record the contextual waiver that native fan-out is deferred and coordinator-sequential remains fail-closed. Add a durable matrix document or test-backed manifest under docs/ or tests/, and update FEATURES.md only if the user-visible contract changes. Run the matrix test and typecheck. " + safety,
  { phase: "Pilot Matrix" },
)

phase("Plan Closure")
const closure = await agent(
  "Apply the closure decision to both temporary plan files and docs/staged-execution-continuity.md. Every Definition-of-Done item must end in one of four explicit states: completed with passing evidence, explicitly waived with rationale, deferred with a named release blocker, or not applicable. Do not silently check an unsafe item. Mark the plans as complete only if every item has an explicit disposition and the release blockers are clearly separated from implementation completion. Preserve scope-batch as deferred/fail-closed, synthetic sequential adapter as not implemented, and native deep links as card-local only. Include the final validation commands and the no-commit/no-push constraint. " + safety,
  { phase: "Plan Closure" },
)

phase("Validation")
const validation = await agent(
  "Perform the final read-only validation after all prior phases. Run the full upstream npm test, upstream typecheck and verify:execution, the full plugin npm test, plugin typecheck, build:reload, package dry-run if safe, and git diff --check in both repositories. Inspect final plan statuses and continuity document. Return a final matrix: implemented, tested, waived, deferred, release blockers, and whether plan closure is authorized. Do not commit or push. " + safety,
  { phase: "Validation" },
)

return {
  state: "succeeded",
  context,
  upstream,
  pilots,
  closure,
  validation,
}
