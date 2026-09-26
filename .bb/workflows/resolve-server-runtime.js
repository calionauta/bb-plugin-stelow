export const meta = {
  name: "resolve-server-runtime",
  description: "Split the oversized server runtime into bounded capability modules with behavior tests and final verification",
  phases: [
    { title: "Implement", detail: "Extract coherent server runtime capabilities" },
    { title: "Review", detail: "Adversarially inspect behavior, boundaries, and tests" },
    { title: "Finalize", detail: "Run all gates and commit the verified result" },
  ],
};

const common = [
  "You are the sole writer for /home/deploy/repos/bb-plugin-stelow on branch refactor/app-slices-1-11.",
  "Never rebase, merge, reset, clean, or discard unrelated work. Preserve untracked paths.",
  "Follow AGENTS.md, especially readable source shape: never compress JSX or logic to satisfy line budgets, and changed lines over 160 characters fail.",
  "Do not touch sync-owned skills/ or data/stelow. Work sequentially with no concurrent writers.",
  "Inspect tests before editing, add executable behavior tests, run focused and full gates, commit conventional changes, and push.",
].join("\n");
const commonPrompt = `\n${common}\n`;

phase("Implement");
const implementation = await agent([
  commonPrompt,
  "Goal: resolve the server runtime composition-root gap. server.ts is already a small facade, but server/plugin-runtime.ts is still a monolith.",
  "Inspect its actual symbols and split the largest safe capability boundaries into cohesive server/runtime modules, keeping a small composition root.",
  "Prefer behavior-preserving extraction over renaming. Add tests that execute the moved seams and guard registration/dispatch behavior.",
  "Do not merely move the whole file. Run focused tests, typecheck, architecture, quality:shape, and relevant full tests.",
  "Commit and push this slice, then report exact modules, symbols, tests, and any bounded remainder.",
].join("\n"), {
  label: "implement:server-runtime",
  phase: "Implement",
  provider: "acp-opencode",
  model: "opencode-go/space-bunny-free",
  reasoningLevel: "medium",
});

phase("Review");
const review = await agent([
  commonPrompt,
  "Fresh adversarial review of the server runtime extraction. Inspect the actual diff and current source, not the implementation report.",
  "Check behavior parity, import direction/cycles, runtime registration, RPC/CLI parity, worker lifecycle, preview/update/GitHub paths, readable line shape,",
  "and whether the monolith was genuinely decomposed rather than relocated.",
  "Run focused tests and mutation-style negative controls. Fix every real issue, commit and push.",
  "Return a severity-ranked gap report and exact remaining oversized symbols.",
].join("\n"), {
  label: "review:server-runtime",
  phase: "Review",
  provider: "acp-opencode",
  model: "opencode-go/space-bunny-free",
  reasoningLevel: "medium",
});

phase("Finalize");
const finalized = await agent([
  commonPrompt,
  "Final gate for the server runtime extraction. Treat prior reports as untrusted. Inspect git status/log, app.tsx and server.ts line counts,",
  "server/plugin-runtime.ts and all new runtime modules, and run typecheck, full npm test, quality:shape, quality:report, architecture,",
  "security:production, and build:reload.",
  "Confirm source shape against its configured baseline, verify bundle provenance where possible, fix remaining bounded issues, commit and push.",
  "Do not claim complete if plugin-runtime.ts or a major handler remains monolithic; return exact blockers if any.",
].join("\n"), {
  label: "finalize:server-runtime",
  phase: "Finalize",
  provider: "acp-opencode",
  model: "opencode-go/space-bunny-free",
  reasoningLevel: "medium",
});

return { implementation, review, finalized };
