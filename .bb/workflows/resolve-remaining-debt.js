export const meta = {
  name: "resolve-remaining-debt",
  description: "Resolve remaining oversized server modules, budget-checker lineage gaps, and master integration debt with coding-standard gates",
  phases: [
    { title: "Audit", detail: "Measure every remaining violation and integration delta" },
    { title: "Github", detail: "Split GitHub automation into bounded modules" },
    { title: "DecisionApi", detail: "Split decision API factories and seams" },
    { title: "BudgetChecker", detail: "Make source budget lineage honest and tested" },
    { title: "Integration", detail: "Prepare and verify the origin/master integration path" },
    { title: "FinalAudit", detail: "Run all gates and report only evidenced completion" },
  ],
};

const common = [
  "You are the sole writer for /home/deploy/repos/bb-plugin-stelow on refactor/app-slices-1-11.",
  "Work sequentially.",
  "Never rebase, merge, reset, clean, or discard unrelated work.",
  "Preserve and classify untracked artifacts.",
  "Follow AGENTS.md and the coding standards: new files under 400 lines, functions under 50,",
  "readable lines under 160 characters, no minification or line-count gaming, and",
  "behavior-first tests with negative controls.",
  "Do not touch sync-owned skills/ or data/stelow.",
  "Never enter a formatting or regex repair loop.",
  "For each phase, inspect actual source/tests first, add executable tests, run typecheck, focused tests,",
  "architecture, source-shape, and source-budget gates, commit conventional changes, and push.",
  "Do not claim completion without repository evidence.",
].join("\n");

const phases = [
  [
    "audit",
    "Audit",
    `Measure the current GitHub, decision API, budget-checker, and origin/master deltas.
Produce exact symbols, line counts, baseline behavior, and an ordered repair list.
Fix nothing broad in this phase; only add a stable baseline report if needed.`,
  ],
  [
    "github",
    "Github",
    `Split server/github-issues.ts and createGithubAutomation into cohesive bounded modules:
migrations, issue listing/creation, comments, automation rules, and completion handling.
Preserve fail-soft behavior, GitHub API contracts, host ownership, and receipts.
Add executable tests and negative controls.
Do not relocate the 942-line function into another oversized file.`,
  ],
  [
    "decision",
    "DecisionApi",
    `Split createDecisionApi and createDecisionApiSeams into cohesive bounded modules for
routing, criteria evaluation, scoring, and persistence.
Preserve decision point routes, refusal shapes, ordering, and idempotency.
Add executable tests and negative controls; do not just rename functions.`,
  ],
  [
    "budget",
    "BudgetChecker",
    `Fix the source-budget checker so inherited/debt classification requires real lineage and
cannot waive a new or rewritten function through unrelated lexical similarity.
Add regression tests for relocation, rewrite, growth, and legitimate inherited debt.
Keep the checker green for real branch debt and update CI/docs truthfully.`,
  ],
  [
    "integration",
    "Integration",
    `Do not reset or rebase this checkout.
Create or use a separate reviewable integration worktree/branch from origin/master,
verify the six master-only commits, and prepare a clean integration result that
preserves the modularization while resolving package/version and documentation conflicts.
Do not merge or tag.
Report exact worktree path, branch, conflict count, and gate results.`,
  ],
  [
    "final",
    "FinalAudit",
    `Run the complete final gate on the current branch and any prepared integration branch:
typecheck, full npm test, quality:shape, source budgets, quality report, architecture,
security:production, build:reload, bundle grep, workflow validation, git diff check,
and origin/master comparison.
Report exact remaining blockers.`,
  ],
];

const agentOptions = {
  provider: "acp-opencode",
  model: "opencode/space-bunny-free",
  reasoningLevel: "medium",
};

const results = [];
let previous = "No prior phase.";
for (let index = 0; index < phases.length; index += 1) {
  const [id, phaseName, goal] = phases[index];
  phase(phaseName);
  const implementation = await agent(
    `${common}
Phase ${index + 1}/${phases.length}: ${id}.
Goal: ${goal}
Prior phase report: ${previous}
Complete only this phase with a bounded acceptance criterion.
Do not broaden scope or loop on formatting.
Commit and push the green phase.`,
    { ...agentOptions, label: `implement:${id}`, phase: phaseName },
  );
  const review = await agent(
    `${common}
Fresh adversarial review of phase ${id}.
Inspect the actual diff and repository, not the implementation report.
Verify behavior parity, source budgets, test value, import direction, cycles, and no gaming.
Run focused tests and one negative control.
Fix real issues, commit and push, and report exact before/after counts.`,
    { ...agentOptions, label: `review:${id}`, phase: phaseName },
  );
  results.push({ id, implementation, review });
  previous = review;
}

phase("FinalAudit");
const final = await agent(`${common}
Synthesize the final evidence.
State which remaining debt is closed, exact line/function counts, all gate results,
integration worktree status, commit/push evidence, working-tree state,
and any genuine blocker.
Do not call inherited debt resolved without a real split.`,
  { ...agentOptions, label: "final-debt-report", phase: "FinalAudit" },
);
return { phases: results, final };
