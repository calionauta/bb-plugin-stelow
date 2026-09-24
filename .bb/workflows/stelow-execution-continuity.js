export const meta = {
  name: "stelow-execution-continuity",
  description: "Audit the two Stelow execution plans against the dirty upstream and BB worktrees, preserve gaps, and produce the next safe sequence",
  phases: [{ title: "Snapshot" }, { title: "Audit" }, { title: "Synthesize" }],
}

phase("Snapshot")
const snapshot = await agent(
  "Read docs/staged-execution-continuity.md, /tmp/opencode/stelow-centralized-stage-execution-plan.md, and /tmp/opencode/stelow-bb-workflows-all-stages-plan.md. Inspect git status in /home/deploy/repos/stelow and the active BB worktree. Do not edit files. Return a compact factual snapshot: repositories, branches, dirty state, validation state, plan status, and the durable continuity document's pending items.",
  { phase: "Snapshot" },
)

phase("Audit")
const audits = await parallel([
  () => agent(
    "Audit the real production wiring of the Stelow BB execution adapter. Read server.ts, server/bb-workflow-bridge.ts, server/bb-workflow-adapter.ts, lib/execution-adapter.mjs, lib/bb-workflow-capabilities.mjs, and related tests. Do not edit files. Determine whether the documented ExecutionAdapter selection/fallback contract is actually the production seam. Return evidence with paths, symbols, missing tests, and severity.",
    { phase: "Audit" },
  ),
  () => agent(
    "Audit both plan files against the current upstream and plugin code. Read both temporary plan files, stages.yaml, recipes, schemas, execution-contract.md, plugin generated catalogs, and continuity status. Do not edit files. Produce a requirement-by-requirement matrix: completed, partial, missing, intentionally deferred, and evidence. Pay special attention to scope-batch, human boundaries, resume, artifacts, migration, pilots, and deep links.",
    { phase: "Audit" },
  ),
  () => agent(
    "Audit the current upstream full-suite debt. Inspect the latest test output if available under /home/deploy/.local/share/opencode/shell and the skill/link/copy tests. Do not edit files. Separate pre-existing packaging/sync debt from execution-plan regressions, quantify failure groups, and recommend the smallest safe remediation order.",
    { phase: "Audit" },
  ),
])

phase("Synthesize")
const synthesis = await agent(
  "Synthesize a continuity decision from the snapshot and audits below. Return an object with: overall_status, completed, partial, pending, blockers, next_actions, and exit_criteria. Be conservative: do not call the plans complete while their own status/checklists or production wiring remain unresolved. Do not edit files and do not recommend commit/push.\\n\\nSNAPSHOT:\\n" +
    JSON.stringify(snapshot) +
    "\\n\\nAUDITS:\\n" +
    JSON.stringify(audits),
  { phase: "Synthesize" },
)

return { state: "succeeded", snapshot, audits, synthesis }
