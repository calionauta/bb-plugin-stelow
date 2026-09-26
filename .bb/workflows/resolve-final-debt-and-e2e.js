export const meta = {
  name: "resolve-final-debt-and-e2e",
  description: "Resolve remaining oversized functions and dead guards, update the upstream blueprint, and verify a Build card end to end",
  phases: [
    { title: "Audit", detail: "Measure remaining server functions, guards, and card E2E prerequisites" },
    { title: "Functions", detail: "Split the remaining owned server functions with behavior tests" },
    { title: "Guards", detail: "Remove dead TypeScript guards without changing runtime behavior" },
    { title: "Blueprint", detail: "Update the upstream Stelow host-plugin blueprint in its own checkout" },
    { title: "E2E", detail: "Create and follow a real Build card through planning depth auto" },
    { title: "FinalAudit", detail: "Run all gates and report exact evidence and residuals" },
  ],
};

const common = `
You are the sole writer for /home/deploy/repos/bb-plugin-stelow on refactor/app-slices-1-11.
Work sequentially. Never rebase, merge, reset, clean, or discard unrelated work.
Preserve untracked artifacts and do not touch sync-owned skills/ or data/stelow.
Follow AGENTS.md and the coding standards: KISS, DRY, LoB, SoC, Fail Fast,
YAGNI, files under 400 lines, functions under 50, readable lines under 160,
no minification or line-count gaming, behavior-first tests, and negative controls.
Do not enter formatting or regex repair loops. Run focused tests, typecheck,
architecture, source-shape, and source-budget gates per phase. Commit and push
this checkout. For the upstream blueprint, use a separate stelow checkout and
commit there; never reset or discard its existing diff. For E2E, use the real
bb stelow CLI and record card id, stage, gates, artifacts, and final state.
`;

const phases = [
  ["audit", "Audit", "Measure every remaining owned server function over 50 lines, the three dead guards, the upstream blueprint location, and the real bb stelow CLI syntax. Fix nothing broad; record exact symbols and safe boundaries."],
  ["functions", "Functions", "Split the remaining owned server functions: createExecutionReconcile, createExecutionNative, createExecutionLifecycle, execution-advance helpers, useGithubDialogState, and PresetManagerDialog. Respect ownership: split logic, do not just relocate it. Add executable behavior tests and negative controls. Treat shadcn primitives and unrelated test fixtures separately with an explicit reason."],
  ["guards", "Guards", "Retire the three dead TypeScript narrowing guards and sibling unreachable error strings using the smallest sound type-level change. Prove with typecheck and focused tests that runtime behavior is unchanged and no dead branch remains."],
  ["blueprint", "Blueprint", "Update /home/deploy/repos/stelow docs/host-plugin-blueprint.md for the portable feature-slice, runtime composition, lifecycle, disposal, and secure subprocess patterns. Preserve any existing upstream diff, commit upstream separately, and push only that checkout's intended change. Also update the local architecture note and link evidence."],
  ["e2e", "E2E", "Use the real bb stelow CLI. Create one Build card on the Stelow board with planning depth set to auto, follow it through triage/planning, inspect its live stage, gates, receipts, and artifacts, and leave an openable record. If the CLI cannot create a card, use the supported RPC/CLI equivalent and report the exact blocker rather than fabricating a card."],
  ["final", "FinalAudit", "Run typecheck, full npm test, quality:shape, source budgets, quality report, architecture, security:production, build:reload, bundle grep, workflow validation, git diff check, and inspect both checkouts and the E2E card. Report exact residuals."],
];

const results = [];
let previous = "No prior phase.";
for (let index = 0; index < phases.length; index += 1) {
  const [id, phaseName, goal] = phases[index];
  phase(phaseName);
  const implementation = await agent(`${common}
Phase ${index + 1}/${phases.length}: ${id}.
Goal: ${goal}
Prior phase report: ${previous}
Complete only this phase with a bounded acceptance criterion. Commit and push the
green phase, and report exact files, tests, counts, and evidence.`,
  {
    label: `implement:${id}`,
    phase: phaseName,
    provider: "acp-opencode",
    model: "opencode/space-bunny-free",
    reasoningLevel: "medium",
  });
  const review = await agent(`${common}
Fresh adversarial review of phase ${id}. Inspect actual source, commits, and
checkouts, not the implementation report. Verify behavior parity, coding
standards, tests, negative controls, source shape, budgets, and evidence. Fix
real issues, commit and push, then report exact before/after state. Do not loop.`,
  {
    label: `review:${id}`,
    phase: phaseName,
    provider: "acp-opencode",
    model: "opencode/space-bunny-free",
    reasoningLevel: "medium",
  });
  results.push({ id, implementation, review });
  previous = review;
}

phase("FinalAudit");
const final = await agent(`${common}
Synthesize the final evidence. State exactly which functions and guards were
split, the upstream blueprint commit, the real Build card id and end-to-end
stage/gate/artifact evidence, all gate results, both checkout states, and any
genuine residual blocker. Never claim an E2E card that was not observed.`,
{
  label: "final-debt-e2e-report",
  phase: "FinalAudit",
  provider: "acp-opencode",
  model: "opencode/space-bunny-free",
  reasoningLevel: "medium",
});
return { phases: results, final };
