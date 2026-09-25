export const meta = {
  name: "scope-batch-safety-contract",
  description: "Prove scope-batch workspace safety: claims, isolation, parent merge, cleanup, retry",
  phases: [
    { title: "Audit", detail: "Inventory current scope-batch coordination and its unsafe edges" },
    { title: "Design", detail: "Design the claims, isolation, merge, cleanup, and retry contract" },
    { title: "Implement", detail: "Build the contract with mutation tests, keeping sequential default" },
    { title: "Verify", detail: "Adversarial safety review plus conflict and retry verification" },
    { title: "Synthesize", detail: "Report what is proven, what still blocks native fan-out" },
  ],
};

const task = args?.task || "Prove scope-batch workspace safety without enabling native fan-out: file-level claims with conflict refusal, write isolation, deterministic cleanup, retry without duplicate side effects, parent merge with post-merge verification, and whole-batch cancellation.";
const constraints = args?.constraints || "Work only in the current repository checkout. Do not edit skills/ or data/stelow. Keep coordinator-sequential as the scope-batch default until every proof below is green. Do not commit, push, open PRs, merge releases, restart the BB daemon, or touch unrelated worktrees.";

phase("Audit");
const audit = await agent(`Audit the current scope-batch execution path: partitioning, worker dispatch, file claims, conflict behavior, parent merge, post-merge verification, cleanup, retry, and cancellation. For each step state whether it is deterministic, tested, fail-soft, or unsafe under concurrent workers. Name the exact files and symbols. Do not edit files. Return evidence.\n\nTask: ${task}\nConstraints: ${constraints}`, {
  phase: "Audit",
  label: "scope-batch-safety-audit",
  schema: {
    type: "object",
    required: ["steps", "unsafeEdges", "testGaps"],
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "symbol", "verdict", "reason"],
          properties: {
            path: { type: "string" },
            symbol: { type: "string" },
            verdict: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      unsafeEdges: { type: "array", items: { type: "string" } },
      testGaps: { type: "array", items: { type: "string" } },
    },
  },
});

phase("Design");
const design = await agent(`Design the smallest safety contract that closes the audit gaps. Define: file-claim acquisition and conflict refusal semantics; write-isolation boundaries; deterministic cleanup after success, failure, and cancellation; idempotent retry keys; parent-merge protocol with post-merge verification; whole-batch cancellation. Every rule needs a mutation/behavior test that fails if the rule is removed. Do not enable fan-out. Do not edit files.\n\nAudit:\n${JSON.stringify(audit)}\n\nTask: ${task}\nConstraints: ${constraints}`, {
  phase: "Design",
  label: "scope-batch-contract-design",
  schema: {
    type: "object",
    required: ["rules", "files", "tests", "nonGoals"],
    properties: {
      rules: {
        type: "array",
        items: {
          type: "object",
          required: ["rule", "enforcement", "mutationTest"],
          properties: {
            rule: { type: "string" },
            enforcement: { type: "string" },
            mutationTest: { type: "string" },
          },
        },
      },
      files: { type: "array", items: { type: "string" } },
      tests: { type: "array", items: { type: "string" } },
      nonGoals: { type: "array", items: { type: "string" } },
    },
  },
});

phase("Implement");
const implementation = await agent(`Implement only the approved contract from this design. Reuse existing lib/ seams (claims, run-bundle, ledger) instead of inventing parallel machinery. Keep scope-batch on coordinator-sequential; add no fan-out path. Add one mutation test per rule and verify each fails when its rule is inverted. Update FEATURES.md and docs/native-workflows.md only if a user-facing contract changes. Run focused tests plus typecheck. Do not commit, push, or merge.\n\nDesign:\n${JSON.stringify(design)}\nConstraints: ${constraints}`, {
  phase: "Implement",
  label: "scope-batch-contract-implementation",
  schema: {
    type: "object",
    required: ["changedFiles", "testsRun", "remainingGaps"],
    properties: {
      changedFiles: { type: "array", items: { type: "string" } },
      testsRun: { type: "array", items: { type: "string" } },
      remainingGaps: { type: "array", items: { type: "string" } },
    },
  },
});

phase("Verify");
const reviews = await parallel([
  () => agent(`Adversarial safety review: inspect the implemented contract. Attempt to construct two workers editing the same file, a retry after partial writes, a cancellation mid-merge, and a parent merge with a failed child. Verify each is refused, cleaned up, or retried idempotently with evidence. Do not edit files. Return blockers.\n\nDesign: ${JSON.stringify(design)}\nImplementation: ${JSON.stringify(implementation)}`, {
    phase: "Verify",
    label: "scope-batch-safety-review",
    schema: {
      type: "object",
      required: ["verdict", "blockers", "evidence"],
      properties: {
        verdict: { type: "string" },
        blockers: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: { type: "string" } },
      },
    },
  }),
  () => agent(`Regression review: verify no execution route changed for eligible native recipes, no cardDetail or RPC contract broke, and the full existing scope-batch behavior is preserved sequentially. Inspect focused tests. Do not edit files. Return blockers.\n\nDesign: ${JSON.stringify(design)}\nImplementation: ${JSON.stringify(implementation)}`, {
    phase: "Verify",
    label: "scope-batch-regression-review",
    schema: {
      type: "object",
      required: ["verdict", "blockers", "evidence"],
      properties: {
        verdict: { type: "string" },
        blockers: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: { type: "string" } },
      },
    },
  }),
]);

phase("Synthesize");
const final = await agent(`Synthesize the final report: which safety rules are proven with which tests, what still blocks native fan-out, and whether the change is merge-ready. Distinguish proven behavior from remaining gaps.\n\nAudit: ${JSON.stringify(audit)}\nDesign: ${JSON.stringify(design)}\nImplementation: ${JSON.stringify(implementation)}\nReviews: ${JSON.stringify(reviews)}`, {
  phase: "Synthesize",
  label: "scope-batch-safety-summary",
  schema: {
    type: "object",
    required: ["status", "proven", "remainingGaps", "mergeRecommendation"],
    properties: {
      status: { type: "string" },
      proven: { type: "array", items: { type: "string" } },
      remainingGaps: { type: "array", items: { type: "string" } },
      mergeRecommendation: { type: "string" },
    },
  },
});

return { audit, design, implementation, reviews, final };
