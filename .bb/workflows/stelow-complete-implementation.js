export const meta = {
  name: "stelow-complete-implementation",
  description: "Run every implementation phase in order with gates: decision router, safety, fan-out, E2E",
  phases: [
    { title: "Phase1", detail: "Decision Router migrations with adversarial and product review" },
    { title: "Phase2", detail: "Scope-batch safety contract with mutation tests, sequential default kept" },
    { title: "Phase3", detail: "Gated native fan-out pilot for one proven scope class" },
    { title: "Phase4", detail: "E2E closure on real cards with mandatory runtime evidence" },
    { title: "Synthesize", detail: "Final report across all phases with merge and rollout guidance" },
  ],
};

const task = args?.task || "Implement the full Stelow roadmap in order: Decision Router migrations, scope-batch safety contract, gated native fan-out pilot, and E2E closure on real cards.";
const constraints = args?.constraints || "Work only in the current repository checkout. Do not edit skills/ or data/stelow. Keep coordinator-sequential wherever safety is unproven. Never declare a pass without runtime evidence. Do not commit, push, open PRs, merge releases, restart the BB daemon, or touch unrelated worktrees.";

function blocked(final, phase) {
  const text = JSON.stringify(final ?? {});
  const negative = /block|reject|fail|not ready|do not merge|don't merge/i.test(text);
  return { phase, negative, text };
}

phase("Phase1");
const phase1 = await workflow({
  name: "implement-decision-router-recommendation",
  args: { task, constraints },
});
const gate1 = blocked(phase1?.final, "Phase1");
if (gate1.negative) {
  return { status: "blocked", blockedAt: "Phase1", gate: gate1.text, phase1 };
}

phase("Phase2");
const phase2 = await workflow({
  name: "scope-batch-safety-contract",
  args: { task, constraints },
});
const gate2 = blocked(phase2?.final, "Phase2");
if (gate2.negative) {
  return { status: "blocked", blockedAt: "Phase2", gate: gate2.text, phase1, phase2 };
}

phase("Phase3");
const phase3 = await workflow({
  name: "native-fanout-pilot",
  args: { task, constraints },
});
const gate3 = blocked(phase3?.final, "Phase3");
if (gate3.negative) {
  return { status: "blocked", blockedAt: "Phase3", gate: gate3.text, phase1, phase2, phase3 };
}

phase("Phase4");
const phase4 = await workflow({
  name: "e2e-closure-validation",
  args: { task, constraints },
});

phase("Synthesize");
const final = await agent(`Synthesize the complete implementation report across all four phases. For each phase state: completed behavior with file and test evidence, remaining gaps, and whether its output is merge-ready. End with one ordered merge/rollout recommendation and the exact validation each step still needs. Do not edit files.\n\nPhase1: ${JSON.stringify(phase1)}\nPhase2: ${JSON.stringify(phase2)}\nPhase3: ${JSON.stringify(phase3)}\nPhase4: ${JSON.stringify(phase4)}`, {
  phase: "Synthesize",
  label: "complete-implementation-summary",
  schema: {
    type: "object",
    required: ["status", "phases", "mergePlan", "remainingGaps"],
    properties: {
      status: { type: "string" },
      phases: { type: "array", items: { type: "string" } },
      mergePlan: { type: "array", items: { type: "string" } },
      remainingGaps: { type: "array", items: { type: "string" } },
    },
  },
});

return { phase1, phase2, phase3, phase4, final };
