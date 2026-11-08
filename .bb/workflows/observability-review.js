export const meta = {
  name: "observability-review",
  description: "Audit the Stelow action log for regressions, instrumentation noise and missing coverage, then verify every finding independently",
  phases: [
    { title: "Audit", detail: "Collect bounded aggregates and classify each signal" },
    { title: "Verify", detail: "Independently confirm or refute each finding against code and queries" },
  ],
};

const since = (args && args.since) || "7d";
const focus = (args && args.focus) || "all kinds";

const collection = `
You are auditing the Stelow plugin's own action log. Work read-only: do not edit
files, do not commit, do not restart any service.

Collect evidence with the bb CLI (the plugin records into its own database):

1. Cause ranking (run it, keep the output):
   bb stelow log --since ${since} --json --limit 5000 | node -e '
   let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{
     const {actions}=JSON.parse(raw); const by={};
     for(const a of actions){const k=\`\${a.kind} \${a.outcome}\${a.cause?" "+a.cause:""}\`;by[k]=(by[k]??0)+a.occurrences;}
     Object.entries(by).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(String(v).padStart(6),k));
   });'

2. Rates: the refused and ok counts for the CLI seam:
   bb stelow log --since ${since} --kind cli.call --outcome refused --json
   bb stelow log --since ${since} --kind cli.call --outcome ok --json

3. Heartbeats: freshness and the slowest pass:
   bb stelow log --since 2h --kind card.tick --json
   bb stelow log --since 2h --kind reconcile.tick --json

4. Failures that lost their reason, host stalls, browser errors, capped at 20 rows each:
   bb stelow log --since ${since} --cause run.no-reason --json
   bb stelow log --since ${since} --cause host.read-miss --json
   bb stelow log --since ${since} --kind ui.error --json

5. Ten representative raw rows:
   bb stelow log --since ${since} --limit 10

Then read docs/observability.md and lib/action-kinds.mjs so the vocabulary you
quote is the real one. Focus: ${focus}.

For each signal, classify it as exactly one of:
  bug        the plugin did something wrong; name the file and the condition
  noise      the instrumentation is too broad; propose a narrower cause
  coverage   a real event has no row; name the seam that should emit one
  host       BB/provider/environment; say what to check outside this repo
  product    a workflow decision, not a defect; say who decides

Return, in order:
  A. The aggregate snapshot you collected (short; numbers, not dumps).
  B. A table: Signal | Evidence (count or row) | Class | Hypothesis |
     How to confirm (command or file:line) | Proposed change | Confidence.
  C. The three findings worth acting on first, ranked by expected value
     (frequency x blast radius), each with the smallest next step.

Rules:
- Never invent a cause string. Causes are dotted codes from the closed catalog.
- "How to confirm" must be something you can run or read; do not guess.
- One row with many occurrences is one finding, not many.
- Do not paste prompt bodies, file contents or assistant text.
`;

phase("Audit");
const audit = await agent(collection, { phase: "Audit", label: "audit:action-log" });

phase("Verify");
const verified = await agent(
  `You are an independent verifier. A first pass audited the Stelow action log and produced the report below.
Do not trust it: for EVERY finding, check the claim yourself against the code in
this checkout and, where useful, by running the same bb stelow log query.
Mark each finding confirmed, refuted, or unverifiable, with the evidence you
saw (file:line or a count you reproduced). Drop refuted and unverifiable items
from the action list, but keep one line naming why they were dropped.

Then return:
  A. The findings table with your verdict column.
  B. The confirmed findings, ranked by expected value.
  C. For each confirmed finding, the smallest correct fix, respecting the repo
     rules: logic in lib/ with a node test authored by a fresh context, wiring
     as a one-line change at the seam, user-facing changes need FEATURES.md.
     Do not implement anything; this pass only decides what is true.

AUDIT REPORT:
${audit}`,
  { phase: "Verify", label: "verify:action-log" },
);

return { since, focus, audit, verified };
