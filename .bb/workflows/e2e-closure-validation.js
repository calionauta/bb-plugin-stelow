export const meta = {
  name: "e2e-closure-validation",
  description: "Close the E2E matrix on real cards: needs-input resume and JTBD lifecycle with evidence",
  phases: [
    { title: "Prepare", detail: "Select real cards and confirm host capacity for new workers" },
    { title: "NeedsInput", detail: "Drive a real question, answer, boundary marker, and child resume" },
    { title: "JTBD", detail: "Drive a real JTBD lifecycle to artifacts and completion" },
    { title: "Verify", detail: "Independent evidence review with no partial-pass claims" },
    { title: "Synthesize", detail: "Record proven scenarios, open blockers, and trail references" },
  ],
};

const task = args?.task || "Prove needs-input/resume and JTBD lifecycle on real cards with runtime evidence: cards, artifacts, receipts, status transitions, trails, and refusals where applicable.";
const constraints = args?.constraints || "Never declare a scenario pass without runtime evidence. Never delete audit cards or projects. Never restart the bb daemon. Never touch the refactor worktree. If new workers stay pending, report the host bottleneck honestly instead of fabricating completion.";

phase("Prepare");
const prep = await agent(`Prepare E2E validation: pick one real card for needs-input/resume and one for JTBD, reusing existing audit cards when possible and creating isolated ones only when needed. Confirm the managed plugin version, the workflows plugin status, and that no active worker blocks new spawns in the chosen environment. Record card ids, environments, and expected evidence per scenario. Do not advance any card yet. Return the plan with evidence expectations.\n\nTask: ${task}\nConstraints: ${constraints}`, {
  phase: "Prepare",
  label: "e2e-preparation",
  schema: {
    type: "object",
    required: ["needsInputCard", "jtbdCard", "environment", "pluginVersions", "evidencePlan"],
    properties: {
      needsInputCard: { type: "string" },
      jtbdCard: { type: "string" },
      environment: { type: "string" },
      pluginVersions: { type: "string" },
      evidencePlan: { type: "array", items: { type: "string" } },
    },
  },
});

phase("NeedsInput");
const needsInput = await agent(`Execute the needs-input scenario on the prepared card: drive the worker to a real pending question, answer it through the real interaction, verify the boundary marker, the child resume, and the stage transition. Persist every step in the card trail. If the worker stays pending or errors, record the exact state and stop — never claim a pass. Return card id, run ids, receipt ids, artifact paths, and transition evidence.\n\nPlan:\n${JSON.stringify(prep)}\nConstraints: ${constraints}`, {
  phase: "NeedsInput",
  label: "e2e-needs-input",
  schema: {
    type: "object",
    required: ["cardId", "verdict", "evidence", "blockers"],
    properties: {
      cardId: { type: "string" },
      verdict: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
      blockers: { type: "array", items: { type: "string" } },
    },
  },
});

phase("JTBD");
const jtbd = await agent(`Execute the JTBD scenario on the prepared card: run the lifecycle to real artifacts, questions if any, stage transitions, and completion or honest refusal. Persist every step in the card trail. If the worker errors or stalls, record the exact state and stop — never claim a pass. Return card id, run ids, artifact paths, and transition evidence.\n\nPlan:\n${JSON.stringify(prep)}\nConstraints: ${constraints}`, {
  phase: "JTBD",
  label: "e2e-jtbd",
  schema: {
    type: "object",
    required: ["cardId", "verdict", "evidence", "blockers"],
    properties: {
      cardId: { type: "string" },
      verdict: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
      blockers: { type: "array", items: { type: "string" } },
    },
  },
});

phase("Verify");
const review = await agent(`Independently verify both scenarios against their claimed evidence: re-read the cards, receipts, artifacts, statuses, and trails. Confirm or reject each pass claim with citations. Any claim without runtime evidence is rejected. Do not edit cards. Return per-scenario verdicts.\n\nNeedsInput: ${JSON.stringify(needsInput)}\nJTBD: ${JSON.stringify(jtbd)}`, {
  phase: "Verify",
  label: "e2e-evidence-review",
  schema: {
    type: "object",
    required: ["needsInputVerdict", "jtbdVerdict", "citations", "openBlockers"],
    properties: {
      needsInputVerdict: { type: "string" },
      jtbdVerdict: { type: "string" },
      citations: { type: "array", items: { type: "string" } },
      openBlockers: { type: "array", items: { type: "string" } },
    },
  },
});

phase("Synthesize");
const final = await agent(`Synthesize the E2E closure report: proven scenarios with trail references, open blockers with exact host state, and whether scope-batch may leave coordinator-sequential. Keep it honest: partial evidence is reported as partial, never as a guarantee.\n\nPrepare: ${JSON.stringify(prep)}\nNeedsInput: ${JSON.stringify(needsInput)}\nJTBD: ${JSON.stringify(jtbd)}\nReview: ${JSON.stringify(review)}`, {
  phase: "Synthesize",
  label: "e2e-closure-summary",
  schema: {
    type: "object",
    required: ["status", "proven", "openBlockers", "scopeBatchRecommendation"],
    properties: {
      status: { type: "string" },
      proven: { type: "array", items: { type: "string" } },
      openBlockers: { type: "array", items: { type: "string" } },
      scopeBatchRecommendation: { type: "string" },
    },
  },
});

return { prep, needsInput, jtbd, review, final };
