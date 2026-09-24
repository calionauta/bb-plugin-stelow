export const meta = {
  name: "stelow-real-work-audit",
  description: "Audit Stelow execution and product skills through real BB host scenarios, with adversarial verification and provenance gating",
  phases: [
    { title: "Provenance", detail: "Verify the active runtime and source identity" },
    { title: "Scenarios", detail: "Run isolated real-work scenarios" },
    { title: "Adversarial Review", detail: "Try to refute each scenario result" },
    { title: "Synthesis", detail: "Publish blockers and confidence" },
  ],
}

const safety = [
  "Do not commit, push, tag, release, merge, reset, clean, or restart bb-daemon.",
  "Do not edit the refactor worktree /home/deploy/repos/bb-plugin-stelow or thread thr_6dbxuhpazg.",
  "Do not delete or archive existing user cards or projects. Use uniquely named audit cards only and leave them auditable.",
  "Do not claim a scenario passed unless you observed the runtime state, artifact, receipt, status, or refusal yourself.",
  "If the active plugin is not the expected integration commit, report blocked rather than silently testing the wrong runtime.",
].join(" ")

const resultSchema = {
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

phase("Provenance")
const provenance = await agent(
  `Audit the active BB host and the source checkout for a real-work Stelow execution audit. Expected integration commit: ${args.expectedCommit}. Expected project: ${args.projectId}. Expected environment: ${args.environmentId}. Use bb status, bb plugin list or equivalent host inspection, and the integration checkout at ${args.integrationPath}. Confirm the active plugin version/source, the installed runtime, and whether it can exercise the integration commit. Do not install or switch the plugin. ${safety}`,
  { label: "provenance", phase: "Provenance", schema: resultSchema },
)

const scenarios = [
  {
    key: "native-card-receipt",
    prompt: "Run one isolated real Build-card scenario through the active Stelow host. Start a safe artifact-only native execution, follow its actual status, verify the required artifact paths and the production registration receipt path, and confirm the card does not advance before the receipt. Use a unique audit marker. Do not fabricate success from source inspection.",
  },
  {
    key: "partial-failure",
    prompt: "Run an isolated real scenario that reaches a native execution failure or malformed/missing artifact outcome. Verify normalized failure state, the exact failure evidence, a trail comment, and that the card remains answerable and unadvanced. If the host cannot induce the failure without mutating user data, report blocked with the exact reason and the safest next command.",
  },
  {
    key: "needs-input-resume",
    prompt: "Run an isolated real needs-input scenario. Reach a native boundary, verify the card has a live answerable question and the boundary marker, answer it through the real card interaction, and verify the child resume state and transition. Do not mark a question answered or resume a run by editing the database directly.",
  },
  {
    key: "scope-batch-fail-closed",
    prompt: "Run an isolated real Build-card execution-stage scenario for scope-batch. Confirm it selects coordinator-sequential, does not start native workspace execution, does not claim nonexistent file ownership, and preserves a valid coordinator exit. Do not implement file claims or workspace fanout during the audit.",
  },
  {
    key: "jtbd-product-skill",
    prompt: "Exercise a real Research-card product-skill path using the JTBD skill. Confirm the skill is loaded as product/workflow guidance, its multi-prompt analysis is reachable through the Stelow card lifecycle, artifacts and questions are recorded, and it is not incorrectly treated as an independent BB Workflows run. Report whether JTBD currently has its own Stelow stage/recipe or only a product skill.",
  },
]

phase("Scenarios")
const scenarioResults = provenance && provenance.status === "pass"
  ? await parallel(scenarios.map((scenario) => () => agent(
    `${scenario.prompt} Project: ${args.projectId}. Environment: ${args.environmentId}. Expected commit: ${args.expectedCommit}. ${safety}`,
    { label: scenario.key, phase: "Scenarios", schema: resultSchema },
  )))
  : scenarios.map((scenario) => ({
    status: "blocked",
    summary: `${scenario.key} was not run because runtime provenance did not prove the expected integration commit.`,
    evidence: [provenance?.summary ?? "No provenance result."],
    blockers: ["Active runtime is not proven to be the expected integration commit."],
    followUp: ["Install or activate the expected integration branch in a controlled environment, then rerun this workflow."],
  }))

phase("Adversarial Review")
const reviewed = await parallel(scenarios.map((scenario, index) => () => agent(
  `Adversarially review this real-work scenario report. Try to refute its status by checking for missing evidence, static-only claims, wrong runtime provenance, fabricated card state, or an unverified lifecycle transition. Return pass only if the report is reproducible and complete; otherwise return fail or blocked. Scenario: ${scenario.key}. Report: ${JSON.stringify(scenarioResults[index])}. ${safety}`,
  { label: `verify:${scenario.key}`, phase: "Adversarial Review", schema: resultSchema },
)))

phase("Synthesis")
const synthesis = await agent(
  `Synthesize this Stelow real-work audit. Distinguish source/static evidence, active-runtime evidence, scenario pass/fail, and blockers. Be explicit about whether the integration commit is actually running. Do not call the work complete if provenance, production receipt, partial failure, needs-input/resume, or scope-batch fail-closed evidence is missing. Recommend the smallest next action for each blocker. Provenance: ${JSON.stringify(provenance)}. Scenario reports: ${JSON.stringify(scenarioResults)}. Adversarial reviews: ${JSON.stringify(reviewed)}. ${safety}`,
  { label: "audit-synthesis", phase: "Synthesis", schema: resultSchema },
)

return { provenance, scenarios: reviewed, synthesis }
