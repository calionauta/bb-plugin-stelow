export const meta = {
  name: "native-fanout-pilot",
  description: "Pilot native BB Workflows fan-out for proven scope classes behind a capability gate",
  phases: [
    { title: "Audit", detail: "Confirm safety proofs exist and select the narrowest pilot scope class" },
    { title: "Design", detail: "Design the capability gate, pilot boundary, and rollback plan" },
    { title: "Implement", detail: "Enable gated fan-out with proofs, keeping sequential default" },
    { title: "Verify", detail: "Adversarial fan-out review with real receipts and artifacts" },
    { title: "Synthesize", detail: "Report pilot outcome and expansion criteria" },
  ],
};

const task = args?.task || "Pilot native BB Workflows fan-out for exactly one proven scope class (independent, non-overlapping scopes with satisfied claims), gated by capability checks, with sequential fallback preserved and instant rollback.";
const constraints = args?.constraints || "Work only in the current repository checkout. Do not edit skills/ or data/stelow. Never enable fan-out for scope-batch generally or for overlapping scopes. Any unproven class stays coordinator-sequential. Do not commit, push, open PRs, merge releases, restart the BB daemon, or touch unrelated worktrees.";

phase("Audit");
const audit = await agent(`Verify the preconditions for a fan-out pilot: the scope-batch safety contract (claims, isolation, merge, cleanup, retry, cancellation) must be implemented and green, with mutation tests. Select the narrowest eligible scope class: independent scopes with disjoint target files and satisfied claims. Reject every class that is not proven. Do not edit files. Return evidence with file paths and test names.\n\nTask: ${task}\nConstraints: ${constraints}`, {
  phase: "Audit",
  label: "fanout-readiness-audit",
  schema: {
    type: "object",
    required: ["preconditionsMet", "pilotClass", "rejectedClasses", "evidence"],
    properties: {
      preconditionsMet: { type: "boolean" },
      pilotClass: { type: "string" },
      rejectedClasses: { type: "array", items: { type: "string" } },
      evidence: { type: "array", items: { type: "string" } },
    },
  },
});

phase("Design");
const design = await agent(`Design the gated pilot: capability-gate checks before any fan-out, per-scope claim verification, bounded concurrency, per-scope receipts and artifacts, parent merge with post-merge verification, sequential fallback on any gate failure, and a one-flag rollback. Define expansion criteria for future classes. Do not edit files.\n\nAudit:\n${JSON.stringify(audit)}\n\nTask: ${task}\nConstraints: ${constraints}`, {
  phase: "Design",
  label: "fanout-pilot-design",
  schema: {
    type: "object",
    required: ["gateChecks", "pilotBoundary", "rollback", "expansionCriteria", "files", "tests"],
    properties: {
      gateChecks: { type: "array", items: { type: "string" } },
      pilotBoundary: { type: "string" },
      rollback: { type: "string" },
      expansionCriteria: { type: "array", items: { type: "string" } },
      files: { type: "array", items: { type: "string" } },
      tests: { type: "array", items: { type: "string" } },
    },
  },
});

phase("Implement");
const implementation = await agent(`Implement only the approved pilot. The default route for every non-pilot class stays coordinator-sequential. Add behavior tests proving: gate failures fall back sequentially; overlapping scopes never fan out; receipts and artifacts land per scope; rollback restores sequential behavior. Update FEATURES.md and docs/native-workflows.md for the pilot boundary. Run focused tests plus typecheck. Do not commit, push, or merge.\n\nDesign:\n${JSON.stringify(design)}\nConstraints: ${constraints}`, {
  phase: "Implement",
  label: "fanout-pilot-implementation",
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
  () => agent(`Adversarial fan-out review: attempt to force fan-out for overlapping scopes, failing claims, and a mid-pilot cancellation. Verify each degrades to sequential or cleans up with evidence, and that real receipts/artifacts exist for every pilot run. Do not edit files. Return blockers.\n\nDesign: ${JSON.stringify(design)}\nImplementation: ${JSON.stringify(implementation)}`, {
    phase: "Verify",
    label: "fanout-adversarial-review",
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
  () => agent(`Contract review: verify no RPC contract broke, the dedicated executionRuns RPC still serves the panel, cardDetail still validates, and sequential behavior is unchanged outside the pilot class. Inspect tests. Do not edit files. Return blockers.\n\nDesign: ${JSON.stringify(design)}\nImplementation: ${JSON.stringify(implementation)}`, {
    phase: "Verify",
    label: "fanout-contract-review",
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
const final = await agent(`Synthesize the pilot report: what ran natively with which receipts, what fell back and why, expansion criteria status, and merge recommendation.\n\nAudit: ${JSON.stringify(audit)}\nDesign: ${JSON.stringify(design)}\nImplementation: ${JSON.stringify(implementation)}\nReviews: ${JSON.stringify(reviews)}`, {
  phase: "Synthesize",
  label: "fanout-pilot-summary",
  schema: {
    type: "object",
    required: ["status", "nativeRuns", "fallbacks", "mergeRecommendation"],
    properties: {
      status: { type: "string" },
      nativeRuns: { type: "array", items: { type: "string" } },
      fallbacks: { type: "array", items: { type: "string" } },
      mergeRecommendation: { type: "string" },
    },
  },
});

return { audit, design, implementation, reviews, final };
