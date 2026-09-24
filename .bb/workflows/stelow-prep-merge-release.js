export const meta = {
  name: "stelow-prep-merge-release",
  description: "Prepare a safe merge and upstream/plugin release plan around the concurrent app.tsx refactor",
  phases: [{ title: "Inventory" }, { title: "Merge Analysis" }, { title: "Release Plan" }],
}

const safety = "Do not commit, push, tag, release, reset, clean, or restart services. Do not edit app.tsx or any file currently owned by the concurrent refactor session. Do not merge branches in this workflow."

phase("Inventory")
const inventory = await agent(
  "Inspect all git worktrees and current branches for /home/deploy/repos/bb-plugin-stelow and the active BB worktree. Identify the concurrent app.tsx refactor session/worktree, its branch, changed paths, and overlap with this execution-plan worktree. Inspect /home/deploy/repos/stelow status and origin relationship. Do not edit files. Return exact merge bases, overlap risks, and whether an integration worktree is needed. " + safety,
  { phase: "Inventory" },
)

phase("Merge Analysis")
const merge = await agent(
  "Read the current plugin diff, especially app.tsx, and compare it with the concurrent refactor worktree without modifying either. Produce a semantic merge plan that separates execution/UI changes from the app.tsx decomposition, identifies likely conflict hunks, and names the smallest integration branch/worktree strategy. Do not run git merge, rebase, reset, checkout, or edit files. " + safety,
  { phase: "Merge Analysis" },
)

phase("Release Plan")
const release = await agent(
  "Inspect upstream package/version/pin state, plugin data/stelow-source.json, sync scripts, package scripts, and current validation evidence. Create a release-readiness report in the response only: exact upstream commit/pin requirements, sync order, plugin version/release order, validation gates, and every action that still requires explicit owner approval. Do not commit, push, tag, or release. " + safety,
  { phase: "Release Plan" },
)

return { state: "succeeded", inventory, merge, release }
