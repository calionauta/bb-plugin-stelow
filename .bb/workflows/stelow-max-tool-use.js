export const meta = {
  name: "stelow-max-tool-use",
  description: "Audit stelow skills for host-tool gaps, apply upstream fixes, verify the diff",
  phases: [{ title: "Audit" }, { title: "Apply" }, { title: "Verify" }],
};

const schema = {
  type: "object",
  required: ["group", "findings"],
  properties: {
    group: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["skill", "file", "line", "current", "replacement", "why"],
        properties: {
          skill: { type: "string" },
          file: { type: "string" },
          line: { type: "string" },
          current: { type: "string" },
          replacement: { type: "string" },
          why: { type: "string" },
        },
      },
    },
  },
};

const tools = [
  "Verified tool facts (from live spikes, do not re-derive):",
  "- sem: diff --format json; impact [--tests/--deps/--dependents] --json",
  "  (needs --file when ambiguous; NO verify subcommand); entities --json;",
  "  grep --json (rg-compatible); log --json (hotspots+co-changes);",
  "  context --budget --headers --json; blame --json; graph --json.",
  "- cymbal: always add --no-federate. investigate, search [--text],",
  "  show, outline -s --names, refs, impact (SYMBOL names only,",
  "  never filenames; use importers for files), context, changed --json,",
  "  trace, impls, importers, diff <symbol>; all --json.",
  "- ripwire JSON-native: --for/--pack-task, --callers/--callees/--impact,",
  "  --test-gate (exit 4 = obligations), --quality-delta, --metrics,",
  "  --plan-lanes --brief=FILE (lane collisions + landing order, exit 0).",
  "  XML-only, avoid for machine use: --situ/--affected/--dead-code.",
  "  Also: --exemplar/--lego (reuse-first), --recall (docs search),",
  "  --from-trace, --cochange/--hotspots/--seams/--report/--arch,",
  "  --lint/--lint-rules, --safe-delete/--edit-check, --grep/--regex,",
  "  --scan-skill(s).",
  "- ast-grep (sg is deprecated): run -p '<pattern>' -l <lang>",
  "  [-r '<fix>'] --json; scan --rule/--inline-rules (YAML lint).",
].join("\n");

const base = [
  "Read-only audit in /home/deploy/repos/stelow (upstream stelow repo).",
  "Do NOT edit, commit, or push anything.",
  "For each assigned skill, find instructions that navigate/search/analyze",
  "code with weak tools (grep/find/git log/manual review) and name",
  "the stronger replacement.",
  "Every finding cites the exact file path and line it improves plus",
  "the concrete replacement command or snippet.",
  "Return ONLY through the structured result tool.",
  "",
].join("\n");

const orchestratorScope = [
  "Scope: skills/stelow-workflow-orchestrator/ (SKILL.md, stages/*.md,",
  "references/cli-tools/*.md) + skills/stelow-workflow-scope-executor/",
  "+ skills/stelow-workflow-entry/ + skills/stelow-workflow-router/.",
  "Group name: orchestrator.",
].join("\n");

const planningScope = [
  "Scope: skills/stelow-workflow-shape-up/",
  "+ skills/stelow-workflow-tech-planning/",
  "+ skills/stelow-workflow-interface-alternatives/",
  "+ skills/stelow-product-scope-mapping/. Group name: planning.",
  "Known true positives to include:",
  "scope-generation.md passes filenames to `cymbal impact`",
  "(it takes symbols only — use `cymbal importers` for files);",
  "it feeds whole spec lines to `cymbal search --text`",
  "(extract concepts first); add ripwire --for/--exemplar/--lego,",
  "sem context --budget, sem log hotspots, ripwire --plan-lanes",
  "for sequencing checks; scope-mapping SKILL.md has zero tool mentions",
  "and needs brownfield-input (cymbal structure, --exemplar/--lego,",
  "sem entities) and greenfield-input (--recall, --plan-lint,",
  "sem on markdown) sections.",
].join("\n");

const critiqueScope = [
  "Scope: skills/stelow-workflow-codebase-critique/",
  "+ skills/stelow-workflow-plan-critique/",
  "+ skills/stelow-workflow-execution-critique/",
  "+ skills/stelow-workflow-coding-standards/",
  "+ skills/stelow-workflow-testing-ai-code/",
  "+ skills/stelow-workflow-testing-execution/",
  "+ skills/stelow-workflow-ux-critique/. Group name: critique.",
  "Prioritize: dead-code detection (sem graph orphans / ripwire --seams",
  "over heuristics), test selection (sem impact --tests / --test-gate),",
  "review evidence (--pr-context / --quality-delta over raw git diff),",
  "standards enforcement (ast-grep YAML rules / --lint-rules over grep -r).",
].join("\n");

const audits = await parallel([
  () => agent(base + tools + "\n" + orchestratorScope, { phase: "Audit", label: "Audit orchestrator skills", schema }),
  () => agent(base + tools + "\n" + planningScope, { phase: "Audit", label: "Audit planning skills", schema }),
  () => agent(base + tools + "\n" + critiqueScope, { phase: "Audit", label: "Audit critique skills", schema }),
]);

const valid = audits.filter(Boolean);

phase("Apply");
const applyRules = [
  "In /home/deploy/repos/stelow, apply skill-instruction improvements",
  "as working-tree edits (DO NOT commit, push,",
  "or touch /home/deploy/repos/bb-plugin-stelow).",
  "Apply every finding below that you verify true by reading the cited",
  "file:line (drop findings that misread the file and say which you",
  "dropped and why).",
  "Also apply these pre-verified fixes:",
  "(1) scope-executor cohesion check (SKILL.md near the cymbal",
  "refs+impact paragraph): replace the manual outline+refs+impact ritual",
  "with one `ripwire <root> --plan-lanes --brief=<file>` call where the",
  "brief has one line per scope (`<id>: <outcome>; files: <target_files>`),",
  "sequentialize pairs from the JSON verdict, land in landing_order;",
  "fallback when ripwire is absent is plain target_files intersection.",
  "(2) tech-planning scope-generation.md: fix `cymbal impact` on filenames",
  "to `cymbal importers`, extract search concepts instead of whole spec",
  "lines, add the ripwire --for/--exemplar and sem context/log steps.",
  "(3) scope-mapping SKILL.md: add brownfield-input and greenfield-input",
  "subsections as described in the planning findings.",
  "Rules: English only, no emojis, minimal diffs, one skill per hunk",
  "where possible. Skills are markdown instruction files;",
  "no tests exist for them.",
  "Return the list of files changed plus a proposed commit message",
  "per skill area.",
  "",
  "Findings:",
  JSON.stringify(valid),
].join("\n");
const applied = await agent(applyRules, { phase: "Apply", label: "Apply upstream skill fixes" });

phase("Verify");
const verifyRules = [
  "In /home/deploy/repos/stelow, red-team the uncommitted working-tree",
  "diff (git diff --stat, git diff). The edits claim to implement",
  "the summary below.",
  "Check: (a) every edit matches a real recommendation and the cited",
  "file:line context; (b) no file outside skills/ was touched;",
  "(c) no `sem verify` references remain anywhere in skills/;",
  "(d) no instruction tells an agent to pass a filename to `cymbal impact`;",
  "(e) English only, no emojis, minimal diffs.",
  "Return PASS/FAIL per check plus any blocking issue. Do not edit anything.",
  "",
  "Claimed summary:",
  String(applied),
].join("\n");
const verdict = await agent(verifyRules, { phase: "Verify", label: "Verify upstream diff" });

return { audits: valid, applied: applied, verdict: verdict };
