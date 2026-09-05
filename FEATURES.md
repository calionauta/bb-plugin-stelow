# Stelow plugin — feature inventory

Grouped by the job the user hires the feature for, not by file.
Source of truth for "what can this plugin do"; see `AGENTS.md`
(Feature inventory) for the update rule.

## 1. Capture work
*When I have an idea, problem, or issue, I want it tracked as work.*

- **New work composer** (`BoardPanel`, `createCard`). Prompt + file/image
  attachments, intent, planning depth, review checkpoints, agent preset from
  the analysis band. Spawns a hidden worker thread starting at triage.
- **GitHub issue import** (`listGithubCandidates`, `importGithubIssue`).
  Tagged issues land in Triage; fresh issues preselected; owning project
  resolved per repo; intent guessed from labels/title (user-correctable).
- **Exploratory work** (`createCardInternal`). "Don't work in a project"
  gets an isolated persistent workspace under
  `~/.bb/stelow/exploratory/<cardId>` backed by the container project
  "Stelow exploratory work".
- **Turn into project** (`promoteCard`). Exploratory-only action that
  creates a real BB project from the card's workspace. Files stay in
  place; the worker continues from the current stage.

