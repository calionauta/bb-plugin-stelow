export const meta = {
  name: "implement-decision-router-recommendation",
  description: "Audit model-assisted decisions, implement safe Decision Router migrations, and verify the result",
  phases: [
    { title: "Audit", detail: "Inventory deterministic and model-assisted decision sites" },
    { title: "Design", detail: "Design named decision points, fallbacks, and evidence contracts" },
    { title: "Implement", detail: "Apply the smallest safe migration with tests and documentation" },
    { title: "Verify", detail: "Run adversarial correctness and product-boundary reviews" },
    { title: "Synthesize", detail: "Summarize changes, remaining gaps, and validation evidence" },
  ],
};

const task = args?.task || "Implement the recommended Decision Router migration for Stelow without weakening deterministic stage, completion, or human-question contracts.";
const constraints = args?.constraints || "Work only in the current repository checkout. Do not edit skills/ or data/stelow. Do not commit, push, open PRs, merge releases, restart the BB daemon, or touch unrelated worktrees.";

phase("Audit");
const audit = await agent(`Audit the current Stelow repository for every place where stage transitions, completion, human questions, classification, semantic review, or worker judgment are decided. Classify each site as deterministic, configured Decision API, configured preset judge, or unclassified model/LLM path. Pay special attention to interface selection, gate pre-review, gap classification, auto-continue, inbox severity, triage intent, and artifact criteria. Identify which migrations are safe now and which require a named decision point, schema, threshold, fallback, and tests. Do not edit files. Return evidence with file paths and symbols.\n\nTask: ${task}\nConstraints: ${constraints}`, {
  phase: "Audit",
  label: "decision-site-audit",
  schema: {
    type: "object",
    required: ["sites", "safeMigrations", "blockedMigrations"],
    properties: {
      sites: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "symbol", "classification", "reason", "recommendation"],
          properties: {
            path: { type: "string" },
            symbol: { type: "string" },
            classification: { type: "string" },
            reason: { type: "string" },
            recommendation: { type: "string" },
          },
        },
      },
      safeMigrations: { type: "array", items: { type: "string" } },
      blockedMigrations: { type: "array", items: { type: "string" } },
    },
  },
});

phase("Design");
const design = await agent(`Design the smallest safe implementation for the audit below. Preserve deterministic lifecycle policy: a model must never decide whether a stage advances, whether a receipt is valid, or whether a human question is required when a contract can decide it. For each proposed semantic classification, define a named decision point, bounded state, question schema, rules mode, configured Decision API mode, explicitly configured preset fallback, confidence threshold, refusal/redirect, and mutation/behavior tests. Do not invent broad migrations for open-ended product judgment. Do not edit files.\n\nAudit:\n${JSON.stringify(audit)}\n\nTask: ${task}\nConstraints: ${constraints}`, {
  phase: "Design",
  label: "decision-migration-design",
  schema: {
    type: "object",
    required: ["approvedMigrations", "rejectedMigrations", "files", "tests"],
    properties: {
      approvedMigrations: {
        type: "array",
        items: {
          type: "object",
          required: ["point", "why", "fallback", "files"],
          properties: {
            point: { type: "string" },
            why: { type: "string" },
            fallback: { type: "string" },
            files: { type: "array", items: { type: "string" } },
          },
        },
      },
      rejectedMigrations: { type: "array", items: { type: "string" } },
      files: { type: "array", items: { type: "string" } },
      tests: { type: "array", items: { type: "string" } },
    },
  },
});

phase("Implement");
const implementation = await agent(`Implement only the approved migrations from this design in the current repository. Use existing central decision seams and conventions; do not duplicate API clients or bypass configured routes. Keep all unknown/missing/low-confidence cases fail-soft to the existing deterministic rules or explicit preset fallback. Add behavior tests that fail if the Decision API path is removed, and tests proving deterministic lifecycle gates remain authoritative. Update FEATURES.md and the linked decision-routing/native-workflows docs when the user-facing contract changes. Run the focused tests and typecheck. Do not commit, push, or merge.\n\nDesign:\n${JSON.stringify(design)}\nConstraints: ${constraints}`, {
  phase: "Implement",
  label: "decision-router-implementation",
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
  () => agent(`Act as an adversarial correctness reviewer. Inspect the current implementation after the implementer. Verify that every approved migration has a real central Decision API path, a deterministic fallback, no silent unconfigured LLM spawn, and no weakening of stage/completion/human-question contracts. Run or inspect focused tests. Do not edit files. Return concrete blockers and evidence.\n\nDesign: ${JSON.stringify(design)}\nImplementation: ${JSON.stringify(implementation)}`, {
    phase: "Verify",
    label: "decision-correctness-review",
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
  () => agent(`Act as a product-boundary and cost reviewer. Inspect the current implementation after the implementer. Check that Decision Router is used for bounded classification, that open-ended synthesis remains with the appropriate worker/reviewer, that user-facing documentation is accurate, and that the workflow does not add unnecessary model calls. Run or inspect the relevant tests. Do not edit files. Return concrete blockers and evidence.\n\nDesign: ${JSON.stringify(design)}\nImplementation: ${JSON.stringify(implementation)}`, {
    phase: "Verify",
    label: "decision-product-review",
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
const final = await agent(`Synthesize the final implementation report from the audit, design, implementation report, and both verification reviews. Distinguish completed behavior from remaining gaps and rejected migrations. Include exact files, tests, and any action required before merge. Do not edit files.\n\nAudit: ${JSON.stringify(audit)}\nDesign: ${JSON.stringify(design)}\nImplementation: ${JSON.stringify(implementation)}\nReviews: ${JSON.stringify(reviews)}`, {
  phase: "Synthesize",
  label: "decision-migration-summary",
  schema: {
    type: "object",
    required: ["status", "completed", "remainingGaps", "mergeRecommendation"],
    properties: {
      status: { type: "string" },
      completed: { type: "array", items: { type: "string" } },
      remainingGaps: { type: "array", items: { type: "string" } },
      mergeRecommendation: { type: "string" },
    },
  },
});

return { audit, design, implementation, reviews, final };
