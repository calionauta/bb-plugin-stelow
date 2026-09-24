export const meta = {
  name: "finish-pending-healthy",
  description: "Recover the interrupted tree, finish bounded runtime slices, stabilize tests and shape gates, reconcile docs, and finish with an evidence-based audit",
  phases: [
    { title: "Recovery", detail: "Inspect and stabilize interrupted worker changes without losing work" },
    { title: "Runtime", detail: "Extract bounded server capabilities without broad rewrites" },
    { title: "Tests", detail: "Replace fragile topology pins with executable behavior seams" },
    { title: "Shape", detail: "Enforce readable source and file/function budgets without test-pin loops" },
    { title: "Docs", detail: "Reconcile architecture docs and blueprint evidence" },
    { title: "Audit", detail: "Run one bounded final gate and classify remaining blockers" },
    { title: "Report", detail: "Publish exact evidence and completion status" },
  ],
};

const common = `
You are the sole writer for /home/deploy/repos/bb-plugin-stelow on refactor/app-slices-1-11. Work sequentially. Never rebase, merge, reset, clean, or discard unrelated work. Preserve and classify untracked paths. Follow AGENTS.md: no minified JSX or logic, changed lines over 160 characters fail, new files stay under 400 lines and functions under 50 unless explicitly dated. Do not touch sync-owned skills/ or data/stelow. Never run broad formatting or edit many regex pins just to make a gate green. Every change must have a behavior reason, focused test, and bounded acceptance criterion. Run gates before and after edits, commit conventional changes, and push. If a phase cannot complete safely, stop and report the exact blocker rather than looping.
`;

phase("Recovery");
const recovery = await agent(`${common}
Recovery phase. The previous workflow was cancelled during a repetitive test-regex loop and left a dirty tree. Inspect git status, diff, recent commits, server/plugin-runtime.ts, the new runtime modules, source-shape/budget scripts, and all modified/untracked tests. Classify every change as coherent work, generated artifact, or accidental loop residue. Do not delete or reset. Repair only broken imports, syntax, or tests caused by the interrupted worker. Do not reformat the whole tree. Commit and push one coherent recovery commit if needed, then report the exact remaining dirty paths and baseline for the next phase.`, { label: "recovery-audit", phase: "Recovery", provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });

phase("Runtime");
const runtime = await agent(`${common}
Runtime phase. Starting from the recovered tree, make one bounded real extraction from server/plugin-runtime.ts. Choose the largest safe capability seam supported by the current code: card lifecycle/RPC dispatch, CLI family, preview/update/platform, or sync/reconciliation. Move ownership and behavior into a cohesive module, keep explicit dependencies, and add executable tests for the seam. Do not touch unrelated test pins or source-shape formatting in this phase. Acceptance: the chosen module is imported by the composition path, old code is removed or delegated, focused tests and typecheck pass, architecture has no cycles, and runtime line/function counts improve. Commit and push; report exact before/after counts and any remaining oversized symbols.`, { label: "runtime-bounded-extraction", phase: "Runtime", provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });

phase("Tests");
const tests = await agent(`${common}
Tests phase. Review only the tests affected by the runtime extraction. Replace topology/regex pins that fail solely because source formatting changed with executable behavior tests or stable exported fixtures. Preserve topology pins that assert counts, refusal shapes, or wiring. Add negative controls for the new seam. Do not repeatedly edit whitespace regexes: inspect the actual source shape once, make one stable fixture/helper, then run the focused test suite. Acceptance: affected tests pass without weakening intent, mutation checks fail when the behavior is broken, and no test-only workaround is introduced. Commit and push, then report tests changed and why.`, { label: "test-seam-stabilization", phase: "Tests", provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });

phase("Shape");
const shape = await agent(`${common}
Shape phase. Run the source-shape and source-budget checkers against the actual branch comparison base. Fix only new or rewritten source lines and newly created budget violations. Never hide violations with baseline exemptions, minification, or regex-pin edits. If inherited debt is reported, separate it from branch debt and document the exception. Reformat extracted code into readable JSX/logic, not single lines. Acceptance: quality:shape passes without false-green bypass, file/function budget checker has no new violations, and focused/full tests still pass. Commit and push, then report remaining inherited debt exactly.`, { label: "readable-source-enforcement", phase: "Shape", provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });

phase("Docs");
const docs = await agent(`${common}
Docs phase. Reconcile README, FEATURES, runtime architecture notes, RFC/module maps, and the upstream stelow host-plugin blueprint with the actual recovered architecture. Preserve existing upstream work and classify local artifacts deliberately; do not delete them. Acceptance: every documented file/module/symbol exists, removed server.ts monolith claims are corrected, portable runtime/lifecycle/disposal patterns have blueprint evidence, and no unrelated sync-owned content is changed. Commit and push only intended docs changes and report the upstream path/commit.`, { label: "architecture-docs", phase: "Docs", provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });

phase("Audit");
const audit = await agent(`${common}
Final bounded audit. Run exactly one complete gate pass: typecheck, npm test, quality:shape, source budgets, quality:report, architecture, security:production, build:reload, bundle grep, workflow validation, git diff check, and origin/master comparison. Inspect the actual working tree and largest functions. Do not start a repair loop. If a gate fails, classify it as a blocker with exact file/symbol/evidence; fix only a tiny isolated issue and rerun that gate once. Commit/push any isolated fix. Return a concise structured verdict: complete, remaining blockers, evidence, and dirty paths.`, { label: "final-bounded-audit", phase: "Audit", provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });

phase("Report");
const report = await agent(`${common}
Produce the final report from the previous phase evidence. State exactly what was recovered, extracted, tested, documented, committed, pushed, and what remains blocked. Include app.tsx/server.ts/plugin-runtime.ts line counts, largest functions, source-shape/budget status, test/security/build gates, origin/master relationship, artifact classification, and no false completion claims.`, { label: "final-healthy-report", phase: "Report", provider: "acp-opencode", model: "opencode/space-bunny-free", reasoningLevel: "medium" });

return { recovery, runtime, tests, shape, docs, audit, report };
