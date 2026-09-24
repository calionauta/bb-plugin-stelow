export const meta = {
  name: "complete-stelow-finalize",
  description: "Finish docs review, final enforcement, completeness audit, repairs, and report after the modularization slices",
  phases: [
    { title: "Review", detail: "Review the completed documentation and blueprint slice" },
    { title: "Finalize", detail: "Run final enforcement and repository gates" },
    { title: "Audit", detail: "Audit every modularization target against repository evidence" },
    { title: "Repair", detail: "Repair any remaining bounded gaps" },
    { title: "Report", detail: "Produce the verified final completion report" },
  ],
};

const common = `
You are the sole writer for a shared BB project checkout on refactor/app-slices-1-11. Never merge, rebase, reset, clean, or discard unrelated work. Never restart bb-daemon. Follow AGENTS.md, especially the readable-source rule: never compact JSX or logic to satisfy LoC, keep changed lines under 160 characters, and run the quality:shape command. Do not touch sync-owned skills/ or data/stelow. Do not ask routine questions.
`;

phase("Review");
const docsReview = await agent(`${common}
Review the completed docs-blueprint slice. Inspect git log, docs/blueprint changes, AGENTS.md, and the actual repository architecture. The prior implementation worker reported success but its final review worker could not start. Verify behavior and documentation claims against source, fix any small real issue, run focused documentation/architecture tests, commit and push fixes if needed. Do not redo the completed app/server extraction.`, { label: "review:docs-blueprint", phase: "Review", provider: "acp-opencode", model: "acp-default", reasoningLevel: "medium" });

phase("Finalize");
const enforcement = await agent(`${common}
Finalize the repository after all app.tsx and server.ts slices. Inspect current git status and line counts first; app.tsx and server.ts should be small composition entry points. Remove or classify generated untracked artifacts only when clearly safe, never delete user work. Run npm run quality:shape, typecheck, full npm test, quality:report, architecture, security checks that are locally available, and build:reload. Fix small enforcement or documentation gaps, commit and push all required changes. Report exact evidence and blockers.`, { label: "final-enforcement", phase: "Finalize", provider: "acp-opencode", model: "acp-default", reasoningLevel: "medium" });

phase("Audit");
const audit = await agent(`${common}
Perform the final completeness audit. Verify app.tsx <=600 lines, server.ts <=600 lines, every new file <=400 lines and readable, functions <=50 or dated exceptions, no avoidable duplication/dead code/cycles, all Build/UI and server slices extracted, docs and blueprint synchronized, source-shape enforcement active, full tests/quality/security/build green, and working tree clean. Inspect actual code and run commands. Fix small issues directly, commit and push, and return structured evidence.`, { label: "completeness-audit", phase: "Audit", provider: "acp-opencode", model: "acp-default", reasoningLevel: "medium", schema: {
  type: "object",
  required: ["complete", "findings", "nextActions", "evidence"],
  properties: {
    complete: { type: "boolean" },
    findings: { type: "array", items: { type: "string" } },
    nextActions: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    commit: { type: ["string", "null"] },
  },
} });

let finalAudit = audit;
for (let round = 1; round <= 3 && finalAudit && finalAudit.complete === false; round += 1) {
  phase("Repair");
  const repair = await agent(`${common}
Repair round ${round}. The final audit found: ${JSON.stringify(finalAudit.findings)}. Required actions: ${JSON.stringify(finalAudit.nextActions)}. Implement only those bounded actions, add or adapt behavior tests, run focused and full gates, commit and push. Return exact evidence.`, { label: `repair-round-${round}`, phase: "Repair", provider: "acp-opencode", model: "acp-default", reasoningLevel: "medium" });
  phase("Audit");
  finalAudit = await agent(`${common}
Re-audit after repair round ${round}. Repair report: ${repair}. Recheck every original target from the previous audit, run all final gates, fix small issues, and return structured evidence. Do not trust the repair report.`, { label: `reaudit-${round}`, phase: "Audit", provider: "acp-opencode", model: "acp-default", reasoningLevel: "medium", schema: {
    type: "object",
    required: ["complete", "findings", "nextActions", "evidence"],
    properties: {
      complete: { type: "boolean" },
      findings: { type: "array", items: { type: "string" } },
      nextActions: { type: "array", items: { type: "string" } },
      evidence: { type: "array", items: { type: "string" } },
      commit: { type: ["string", "null"] },
    },
  } });
}

phase("Report");
const report = await agent(`${common}
Produce the final user-facing report from repository evidence. Verify git status/log, app.tsx/server.ts line counts, all recent slice commit SHAs, tests, quality, security, build/reload, audit result, and genuine blockers. State clearly what is complete and what remains. Do not make feature changes unless a tiny report correction is required.
Docs review: ${docsReview}
Final enforcement: ${enforcement}
Final audit: ${JSON.stringify(finalAudit)}`, { label: "final-report", phase: "Report", provider: "acp-opencode", model: "acp-default", reasoningLevel: "medium" });

return { docsReview, enforcement, audit: finalAudit, report };
