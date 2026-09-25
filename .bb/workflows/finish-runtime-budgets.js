export const meta = {
  name: "finish-runtime-budgets",
  description: "Continue extracting every remaining oversized server runtime function until source budgets are green",
  phases: [
    { title: "Decisions", detail: "Extract decision, judging, and scoring handlers" },
    { title: "Workers", detail: "Extract worker respawn, staleness, and evidence handlers" },
    { title: "Questions", detail: "Extract question, answer, gate, and nudge handlers" },
    { title: "Cards", detail: "Extract card update, diff, reseed, and lifecycle handlers" },
    { title: "Research", detail: "Extract remaining research and execution handlers" },
    { title: "CLI", detail: "Extract the remaining CLI export bundle handler" },
    { title: "Budgets", detail: "Run and fix the complete source budget gate" },
    { title: "FinalAudit", detail: "Verify all gates and report exact remaining debt" },
  ],
};

const common = `
You are the sole writer for /home/deploy/repos/bb-plugin-stelow on refactor/app-slices-1-11. Work sequentially; never rebase, merge, reset, clean, or discard unrelated work. Preserve untracked artifacts. Follow AGENTS.md and coding standards: no minified logic, no long-line compression, new files under 400 lines and functions under 50 unless explicitly dated. Do not touch sync-owned skills/ or data/stelow. Do not enter regex or formatting loops. For each bounded phase, inspect actual source/tests first, extract ownership rather than relocate it, add executable behavior tests and negative controls, run typecheck, focused tests, architecture, and source budgets, commit, and push. Continue to the next planned phase even when unrelated inherited debt remains; the final phase is the only place to declare a blocker.
`;

const phases = [
  ["decisions", "Decisions", "Extract judgeViaPreset, judgePresetCriteria, judgeScoredBatch, requestGatePreReview if still present, and related scoring/decision helpers into cohesive decision modules. Preserve RPC names, refusal shapes, preset behavior, and scoring order."],
  ["workers", "Workers", "Extract prepareWorkerRespawn, stalenessForQuestions, discardEvidence, and worker/evidence coordination into bounded modules. Preserve worker lifecycle, terminal guards, and fail-soft behavior."],
  ["questions", "Questions", "Extract questionContractsGate, critiqueGapState, answerQuestions, answerExpiredQuestions, gapSummary, qualitySeal, and related question/gate helpers. Preserve ask state transitions, refusals, and receipts."],
  ["cards", "Cards", "Extract updateCard, notifyClaimWaiters, approveGate, advanceCard, cardDiff, reseedCard, auditTrailStatus, and remaining card mutation handlers. Preserve action ordering, permissions, and recovery behavior."],
  ["research", "Research", "Extract researchIndex, fanOutResearch, runResearchStrategy, and remaining research/explore/execution handlers. Preserve track-specific contracts, worker prompts, and failure semantics."],
  ["cli", "CLI", "Extract runCliCommand/exportRunBundle and the remaining large CLI family until the dispatcher is small and command families are cohesive. Preserve help, unknown command, errors, exit codes, and export behavior."],
  ["budgets", "Budgets", "Run source-shape and source-budget checks against origin/master. Fix every branch-owned violation by real extraction or readable formatting. Do not add exemptions. Commit and push the green budget state."],
  ["final", "FinalAudit", "Run typecheck, full npm test, focused runtime tests, quality:shape, source budgets, quality:report, architecture, security:production, build:reload, bundle grep, workflow validation, git diff check, and origin/master comparison. Do not claim completion if any branch-owned budget remains."],
];

const phaseNames = Object.fromEntries(phases.map(([id, name]) => [id, name]));
const results = [];
let previous = "No prior phase.";
for (let index = 0; index < phases.length; index += 1) {
  const [id, phaseName, goal] = phases[index];
  phase(phaseName);
  const implementation = await agent(`${common}
Phase ${index + 1}/${phases.length}: ${id}.
Goal: ${goal}
Prior phase report: ${previous}
Measure the exact current functions and line counts before editing. Complete only this phase, preserving the composition contract and avoiding duplicate wrappers. If a named function is already extracted, verify it and improve the boundary rather than redoing it. Commit and push the phase.`, { label: `implement:${id}`, phase: phaseName, provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });
  const review = await agent(`${common}
Fresh adversarial review of phase ${id}. Inspect actual source and commits, not reports. Verify behavior parity, import direction, cycles, registration, lifecycle, fail-soft paths, test value, and exact budget reduction. Run focused tests and a negative control. Fix real issues, commit and push. Do not broaden scope or start a loop.`, { label: `review:${id}`, phase: phaseName, provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });
  results.push({ id, implementation, review });
  previous = review;
}

phase("FinalAudit");
const final = await agent(`${common}
Final synthesis. Inspect the actual repository and all phase reports. Report exact server/plugin-runtime.ts line count, largest remaining functions, source-budget result, source-shape result, all gates, commit/push evidence, clean tree, origin/master comparison, and any blocker. Do not claim completion without repository evidence.`, { label: "final-budget-report", phase: "FinalAudit", provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });
return { phases: results, final };
