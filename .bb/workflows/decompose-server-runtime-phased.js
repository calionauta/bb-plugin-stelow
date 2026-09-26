export const meta = {
  name: "decompose-server-runtime-phased",
  description: "Phase the oversized server runtime into real bounded capabilities with review and verification after every slice",
  phases: [
    { title: "Composition", detail: "Extract plugin composition and registration ownership" },
    { title: "CLI", detail: "Break the CLI dispatcher into command-family modules" },
    { title: "Continuation", detail: "Break continue nudge and worker continuation behavior" },
    { title: "Cards", detail: "Break card detail and card lifecycle handlers" },
    { title: "Sync", detail: "Break thread sync and worker state projection" },
    { title: "Research", detail: "Break research and explore capability handlers" },
    { title: "Operations", detail: "Break update, retry, move, split, and recovery operations" },
    { title: "Budgets", detail: "Enforce file and function budgets without exemptions" },
    { title: "FinalAudit", detail: "Run the complete gates and report exact evidence" },
  ],
};

const common = [
  "",
  "You are the sole writer for /home/deploy/repos/bb-plugin-stelow on refactor/app-slices-1-11.",
  "Work sequentially. Never rebase, merge, reset, clean, or discard unrelated work.",
  "Preserve untracked artifacts.",
  "Follow AGENTS.md and the coding standards:",
  "LoC is a safety limit, never a formatting target;",
  "no minified JSX or logic;",
  "changed source lines over 160 characters fail;",
  "new files stay under 400 lines and functions under 50 unless explicitly dated.",
  "Do not touch sync-owned skills/ or data/stelow.",
  "Never enter a regex or formatting loop.",
  "For each slice, inspect the actual source and existing tests first,",
  "add executable behavior tests and one negative control,",
  "run focused tests, typecheck, architecture, and the relevant budget check,",
  "commit a conventional slice, and push.",
  "Do not rewrite unrelated tests.",
  "If a gate fails, identify the exact symbol and continue with the next bounded plan item",
  "rather than repeating the same repair.",
  "",
].join("\n");

const slices = [
  {
    id: "composition",
    goal: [
      "Extract plugin composition, dependency assembly, and event/scheduler/RPC registration",
      "from server/plugin-runtime.ts into cohesive modules.",
      "Keep the exported plugin contract identical and leave no upward imports or cycles.",
    ].join(" "),
  },
  {
    id: "cli",
    goal: [
      "Extract the largest CLI command family from runCliCommand into a cohesive command module",
      "and leave a small dispatcher.",
      "Preserve help, unknown command, exit, and error behavior.",
      "Add executable tests for the moved family.",
    ].join(" "),
  },
  {
    id: "continuation",
    goal: [
      "Extract buildContinueNudge and its worker continuation helpers into bounded modules.",
      "Preserve private nudge visibility, question/evidence guards, and budget recording.",
      "Add negative controls for public/private behavior.",
    ].join(" "),
  },
  {
    id: "cards",
    goal: [
      "Extract cardDetail and its cohesive subhandlers into detail, card mutation,",
      "and publication/lifecycle modules.",
      "Preserve RPC names, refusals, and fail-soft paths.",
      "Add tests for representative success and refusal branches.",
    ].join(" "),
  },
  {
    id: "sync",
    goal: [
      "Extract syncThreadState, thread lifecycle projection,",
      "and related persistence coordination into bounded modules.",
      "Preserve event ordering, terminal guards, and recovery behavior.",
      "Add executable state-transition tests.",
    ].join(" "),
  },
  {
    id: "research",
    goal: [
      "Extract research and explore worker/prompt/index/artifact capability handlers",
      "into separate bounded modules.",
      "Preserve track-specific contracts and fail-soft behavior.",
      "Add representative tests for each track.",
    ].join(" "),
  },
  {
    id: "operations",
    goal: [
      "Extract update, retry, move, split, reseed, discard, and recovery operations",
      "into cohesive modules.",
      "Preserve action ordering, refusals, worker lifecycle, and receipts.",
      "Add behavior tests and negative controls.",
    ].join(" "),
  },
  {
    id: "budgets",
    goal: [
      "After the capability slices, run source-shape and source-budget checks against origin/master.",
      "Fix remaining branch-owned violations by extraction or readable formatting,",
      "never by baseline exemptions or minification.",
      "Update CI/tests only when they enforce real budgets.",
    ].join(" "),
  },
  {
    id: "final",
    goal: [
      "Run the complete final gate: typecheck, full npm test, quality:shape, source budgets,",
      "quality:report, architecture, security:production, build:reload, bundle grep,",
      "workflow validation, git diff check, and origin/master comparison.",
      "Classify any blocker with exact file/symbol evidence; do not loop.",
    ].join(" "),
  },
];

const phaseNames = {
  composition: "Composition",
  cli: "CLI",
  continuation: "Continuation",
  cards: "Cards",
  sync: "Sync",
  research: "Research",
  operations: "Operations",
  budgets: "Budgets",
  final: "FinalAudit",
};

const results = [];
let previous = "No prior slice.";
for (let index = 0; index < slices.length; index += 1) {
  const { id, goal } = slices[index];
  const phaseName = phaseNames[id];
  phase(phaseName);
  const implementationPrompt = `${common}
Phase ${index + 1}/${slices.length}: ${id}.
Goal: ${goal}
Prior phase report: ${previous}
Start by measuring the exact symbols and tests affected.
Complete only this phase.
Keep the composition root small and the extracted module cohesive.
If the source is already partly extracted, verify and improve the real boundary rather than duplicating it.
Commit and push the green phase.`;
  const implementation = await agent(implementationPrompt, {
    label: `implement:${id}`,
    phase: phaseName,
    provider: "acp-opencode",
    model: "opencode/space-bunny-free",
    reasoningLevel: "medium",
  });
  const reviewPrompt = `${common}
Fresh adversarial review of phase ${id}.
Inspect the actual diff and current source, not the implementation report.
Check behavior parity, import direction, cycles, RPC/CLI registration, lifecycle,
fail-soft paths, readable source shape, and test value.
Run focused tests and one negative control.
Fix every real issue, commit and push.
Return exact before/after line and function counts plus remaining blockers;
do not start a broad repair loop.`;
  const review = await agent(reviewPrompt, {
    label: `review:${id}`,
    phase: phaseName,
    provider: "acp-opencode",
    model: "opencode/space-bunny-free",
    reasoningLevel: "medium",
  });
  results.push({ id, implementation, review });
  previous = review;
}

phase("FinalAudit");
const finalPrompt = `${common}
Final synthesis.
Read the phase reports and inspect the repository.
State whether server/plugin-runtime.ts is now a real bounded composition root
rather than a relocated monolith.
List exact remaining oversized files/functions, every gate result,
commit/push evidence, working-tree state, origin/master comparison, and any genuine blocker.
Do not claim completion without repository evidence.`;
const final = await agent(finalPrompt, {
  label: "final-runtime-report",
  phase: "FinalAudit",
  provider: "acp-opencode",
  model: "opencode/space-bunny-free",
  reasoningLevel: "medium",
});
return { slices: results, final };
