export const meta = {
  name: "finish-pending-work",
  description:
    "Finish the remaining server runtime, source-shape, budgets, blueprint, artifact, and final-audit work",
  phases: [
    {
      title: "Runtime",
      detail: "Decompose the server runtime into real bounded capabilities",
    },
    {
      title: "Quality",
      detail: "Make source shape and function/file budgets pass honestly",
    },
    {
      title: "Docs",
      detail: "Reconcile runtime documentation and the upstream blueprint",
    },
    {
      title: "Audit",
      detail:
        "Run adversarial final verification and repair remaining blockers",
    },
    {
      title: "Report",
      detail: "Publish the final evidence and exact completion state",
    },
  ],
};

const common = `
You are the sole writer for /home/deploy/repos/bb-plugin-stelow on branch
refactor/app-slices-1-11. Never rebase, merge, reset, clean, or discard unrelated
work. Preserve and classify untracked paths; never delete them implicitly. Follow
AGENTS.md: no minified JSX or logic to satisfy LoC, changed source lines over 160
characters are failures, new files stay under 400 lines and functions under 50
lines unless explicitly dated. Do not touch sync-owned skills/ or data/stelow.
Inspect tests before editing, add executable behavior tests and negative controls,
run focused and full gates, commit conventional changes, and push. Do not claim
completion without evidence.
`;

phase("Runtime");
const runtime = await agent(
  `${common}
Finish the real server runtime decomposition. Inspect the current 6,434-line
server/plugin-runtime.ts and the already extracted server/runtime modules. Extract
cohesive ownership for card lifecycle/RPC dispatch, CLI families, preview/update/platform,
sync/reconciliation, and remaining lifecycle/startup behavior into bounded modules.
Keep server.ts and the composition root thin. Do not merely move the monolith or
rename functions. Preserve behavior, avoid cycles, add executable tests at each
seam, and run typecheck, focused tests, architecture, quality:shape, and relevant
full tests. Commit and push each safe slice. Return exact line counts and any
symbols still oversized.`,
  {
    label: "runtime-decomposition",
    phase: "Runtime",
    provider: "acp-opencode",
    model: "opencode/space-bunny-free",
    reasoningLevel: "medium",
  },
);

phase("Quality");
const quality = await agent(
  `${common}
Make source-shape and budget enforcement honest and green for the branch. Reformat
or extract all remaining changed lines over 160 characters without compression,
especially server/plugin-runtime.ts. Extend the checker/tests to cover the actual
branch diff and file/function budgets, with negative controls for long lines,
rewritten debt, and budget growth. Remove false-green relocation/baseline loopholes
while reporting inherited debt explicitly. Keep CI aligned with the checker. Run
source-shape tests, typecheck, full tests, quality report, and architecture. Commit
and push.`,
  {
    label: "quality-enforcement",
    phase: "Quality",
    provider: "acp-opencode",
    model: "opencode/space-bunny-free",
    reasoningLevel: "medium",
  },
);

phase("Docs");
const docs = await agent(
  `${common}
Reconcile documentation with the actual final architecture. Update
README/FEATURES/docs/runtime-architecture and any stale RFC/module-map references.
In the upstream stelow checkout, add or update the matching
docs/host-plugin-blueprint.md proposal for feature slices, runtime composition,
lifecycle, disposal, and secure subprocess boundaries; preserve any existing
upstream diff and do not silently discard it. Classify .agents/, skills-lock.json,
and docs/runs/card_*/ deliberately. Do not delete artifacts without evidence.
Commit and push only intended repository changes and report the upstream
commit/path.`,
  {
    label: "docs-blueprint",
    phase: "Docs",
    provider: "acp-opencode",
    model: "opencode/space-bunny-free",
    reasoningLevel: "medium",
  },
);

phase("Audit");
const audit = await agent(
  `${common}
Perform a fresh adversarial final audit after runtime, quality, and docs work.
Inspect actual code and commits, not prior reports. Verify app.tsx/server.ts/runtime
line counts, file/function budgets, source shape, all tests, lifecycle/RPC behavior,
security boundaries, origin/master integration, docs truthfulness, artifact
classification, and working tree cleanliness. Run typecheck, full npm test,
quality:shape, quality:report, architecture, security:production, build:reload,
bundle inspection, and workflow validation. Fix small issues, commit and push.
Return structured evidence and do not call it complete if a major blocker remains.`,
  {
    label: "final-adversarial-audit",
    phase: "Audit",
    provider: "acp-opencode",
    model: "opencode/space-bunny-free",
    reasoningLevel: "medium",
  },
);

phase("Report");
const report = await agent(
  `${common}
Produce the final evidence-based report. Include every commit and push, exact
app/server/runtime line counts and largest symbols, source-shape and budget
results, tests/security/build gates, origin/master relationship, docs/blueprint
commit, artifact classification, and any genuine blockers. State clearly whether
every pending item is resolved.`,
  {
    label: "final-pending-report",
    phase: "Report",
    provider: "acp-opencode",
    model: "opencode/space-bunny-free",
    reasoningLevel: "medium",
  },
);

return { runtime, quality, docs, audit, report };
