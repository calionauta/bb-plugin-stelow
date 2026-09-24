export const meta = {
  name: "stelow-real-scenarios",
  description: "Run Stelow execution scenarios against the active integration runtime and adversarially verify observed evidence",
  phases: [
    { title: "Scenarios", detail: "Exercise real cards and runtime transitions" },
    { title: "Verification", detail: "Refute unsupported scenario claims" },
    { title: "Synthesis", detail: "Report release blockers honestly" },
  ],
}

const safety = [
  "Do not commit, push, tag, release, merge, reset, clean, or restart bb-daemon.",
  "Do not edit /home/deploy/repos/bb-plugin-stelow or thread thr_6dbxuhpazg.",
  "Do not delete or archive existing user cards or projects.",
  "Use only uniquely named audit cards and leave them auditable.",
  "Do not claim pass without observed runtime evidence: command output, card state, workflow run, artifact, receipt, status, or refusal.",
  "If the active runtime is not v0.48.0, report blocked instead of testing the wrong plugin.",
].join(" ")

const schema = {
  type: "object",
  required: ["status", "summary", "evidence", "blockers"],
  properties: {
    status: { enum: ["pass", "fail", "blocked", "not_run"] },
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    blockers: { type: "array", items: { type: "string" } },
    followUp: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
}

const scenarios = [
  {
    key: "native-card-receipt",
    prompt: "Run a real isolated Build-card artifact-only native execution. Use the active BB Stelow plugin and a unique audit marker. Start it through the real card/host path, follow status, verify required artifacts, verify the production .registered.json receipt, and prove the card cannot advance before the receipt. Do not use direct database edits.",
  },
  {
    key: "partial-failure",
    prompt: "Run a real isolated execution that reaches a native failure or malformed/missing artifact outcome. Verify normalized failed state, exact evidence, trail comment, and that the card remains answerable and unadvanced. If a safe failure cannot be induced, report blocked with the exact reason instead of inventing one.",
  },
  {
    key: "needs-input-resume",
    prompt: "Run a real isolated needs-input scenario. Reach a native boundary, verify the live answerable question and boundary marker, answer it through the real card interaction, and verify the child resume and transition. Do not mark answered or resume by direct database edits.",
  },
  {
    key: "scope-batch-fail-closed",
    prompt: "Run a real isolated Build-card execution-stage scope-batch scenario. Confirm the route is coordinator-sequential, native workspace execution is not started, no false native claim is made, and the coordinator exit is recorded. Do not implement new claims during the audit.",
  },
  {
    key: "jtbd-product-skill",
    prompt: "Run a real isolated Research-card JTBD scenario. Load the JTBD product skill, verify its multi-prompt method is reachable through the Stelow card lifecycle, verify artifacts/questions are recorded, and determine whether JTBD is a product skill or a separate BB Workflow.",
  },
]

phase("Scenarios")
const results = await pipeline(
  scenarios,
  (scenario) => agent(
    `${scenario.prompt} Active runtime was manually verified before launch as Stelow v0.48.0 from /tmp/opencode/bb-plugin-stelow-integration. Project ${args.projectId}; environment ${args.environmentId}. ${safety}`,
    { provider: "acp-opencode", model: "opencode-go/space-bunny-free", reasoningLevel: "medium", label: scenario.key, phase: "Scenarios", schema },
  ),
  (result, scenario) => result ? agent(
    `Adversarially verify this ${scenario.key} result. Check the actual runtime, card identity, status transitions, artifacts, receipt, trail, and refusals. Refute any static-only or fabricated claim. ${safety}\nReport: ${JSON.stringify(result)}`,
    { provider: "acp-opencode", model: "opencode-go/space-bunny-free", reasoningLevel: "medium", label: `verify:${scenario.key}`, phase: "Verification", schema },
  ) : null,
)

phase("Synthesis")
const synthesis = await agent(
  `Synthesize these real-work Stelow scenario results. Separate observed runtime evidence from source claims. A scenario is pass only if its verification result is pass with concrete evidence. Keep B-SCOPE-1, production receipt, partial failure, and needs-input/resume open if their evidence is missing. Recommend the smallest next action. ${safety}\nResults: ${JSON.stringify(results)}`,
  { provider: "acp-opencode", model: "opencode-go/space-bunny-free", reasoningLevel: "medium", label: "audit-synthesis", phase: "Synthesis", schema },
)
return results ? { scenarios: results, synthesis } : { scenarios: [], synthesis }
