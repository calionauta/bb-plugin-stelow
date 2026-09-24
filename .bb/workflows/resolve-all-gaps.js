export const meta = {
  name: "resolve-all-gaps",
  description: "Resolve every verified modularization gap with sequential repairs, adversarial review, final audit, and evidence",
  phases: [
    { title: "Audit", detail: "Re-audit the current branch against every known gap" },
    { title: "Repair", detail: "Apply bounded fixes for runtime, tests, security, docs, and integration" },
    { title: "Review", detail: "Adversarially verify each repair and fix regressions" },
    { title: "Finalize", detail: "Run the complete quality, security, build, and runtime gates" },
    { title: "Report", detail: "Publish an evidence-based final gap report" },
  ],
};

const common = `
You are the sole writer for /home/deploy/repos/bb-plugin-stelow on branch refactor/app-slices-1-11. Never rebase, merge,
reset, clean, or discard unrelated work. Preserve and explicitly classify untracked paths; never delete them implicitly.
Follow AGENTS.md, especially the readable-source rule: never minify JSX or logic to satisfy LoC, keep changed source
lines under 160 characters, and run npm run quality:shape. Do not touch sync-owned skills/ or data/stelow. Work
sequentially; never spawn concurrent writers. Inspect existing tests before editing, add executable behavior tests, run
focused and full gates, commit conventional changes, and push. Do not ask routine questions. Do not claim a gap is
closed without evidence.
`;

phase("Audit");
const audit = await agent(`${common}
Perform a fresh adversarial audit of the current branch. Do not trust earlier reports. Verify actual git status/log,
app.tsx, server.ts, server/plugin-runtime.ts, all server/runtime modules, tests, docs, CI, workflow files, and
origin/master divergence. Check: real capability decomposition versus facade relocation; line/function budgets; behavior
parity; executable lifecycle/startup/RPC tests; installer provenance and subprocess environment security; source-shape
enforcement and CI; documentation/blueprint accuracy; untracked artifact classification; and merge safety with current
master. Run every practical gate. Fix only tiny safe issues, then return structured findings and exact next actions.`, {
  label: "complete-gap-audit",
  phase: "Audit",
  provider: "codex",
  model: "gpt-6-sol",
  reasoningLevel: "medium",
  schema: {
    type: "object",
    required: ["complete", "findings", "nextActions", "evidence"],
    properties: {
      complete: { type: "boolean" },
      findings: { type: "array", items: { type: "string" } },
      nextActions: { type: "array", items: { type: "string" } },
      evidence: { type: "array", items: { type: "string" } },
      commit: { type: ["string", "null"] },
    },
  },
});

let finalAudit = audit;
for (let round = 1; round <= 3 && finalAudit && finalAudit.complete === false; round += 1) {
  phase("Repair");
  const repair = await agent(`${common}
Repair round ${round}. Address the following findings as bounded, sequential slices:
${JSON.stringify(finalAudit.findings)}. Required actions: ${JSON.stringify(finalAudit.nextActions)}. Start with the
highest-risk runtime/test/security issue, then documentation/integration/local-state issues. For each slice inspect
tests first, add behavior tests and negative controls, avoid long-line compression, run focused and full gates, commit
and push. If integration with origin/master requires a separate worktree, create/use it without resetting this checkout,
preserve newer master functionality, and report the exact branch/worktree evidence. Do not merely document unresolved
code as complete.`, {
    label: `repair-round-${round}`,
    phase: "Repair",
    provider: "codex",
    model: "gpt-6-sol",
    reasoningLevel: "medium",
  });

  phase("Review");
  const review = await agent(`${common}
Fresh adversarial review after repair round ${round}. Inspect the actual commits and working tree, not the repair
report. Verify behavior, imports/cycles, real decomposition, test executability, security boundaries, source-shape/CI
wiring, docs truthfulness, and branch safety. Run mutation-style negative controls where possible. Fix all real issues,
commit and push, and return a structured re-audit.`, {
    label: `review-round-${round}`,
    phase: "Review",
    provider: "codex",
    model: "gpt-6-sol",
    reasoningLevel: "medium",
    schema: {
      type: "object",
      required: ["complete", "findings", "nextActions", "evidence"],
      properties: {
        complete: { type: "boolean" },
        findings: { type: "array", items: { type: "string" } },
        nextActions: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: { type: "string" } },
        commit: { type: ["string", "null"] },
      },
    },
  });
  finalAudit = review;
}

phase("Finalize");
const finalized = await agent(`${common}
Final gate for the entire gap-resolution effort. Treat all prior reports as untrusted. Inspect current git status/log,
origin/master relationship, app.tsx/server.ts/plugin-runtime.ts line counts and largest functions, all tests,
docs/blueprint, CI, workflow validation, and untracked artifacts. Run typecheck, full npm test, quality:shape,
quality:report, architecture, security:production, build:reload, and verify bundle provenance. Confirm the source-shape
baseline and executable tests are committed. Fix any small remaining issue, commit and push. If a major gap remains,
return it explicitly as a blocker instead of claiming completion.`, {
  label: "finalize-all-gaps",
  phase: "Finalize",
  provider: "codex",
  model: "gpt-6-sol",
  reasoningLevel: "medium",
});

phase("Report");
const report = await agent(`${common}
Produce the final evidence-based report. Include branch and commit/push status, all repaired gaps, exact remaining
blockers, app/server/runtime line counts, largest remaining symbols, test/gate results, security results, workflow
validation, docs status, untracked artifact classification, and integration status with origin/master. State clearly
whether all pending work is resolved.`, {
  label: "final-report-all-gaps",
  phase: "Report",
  provider: "codex",
  model: "gpt-6-sol",
  reasoningLevel: "medium",
});

return { audit, finalAudit, finalized, report };
