/**
 * Per-kind evidence contracts for trackables (data, no logic).
 *
 * The machine in lib/trackables.mjs is kind-blind by design; this table
 * records, per kind, who writes the status and what evidence a `done`
 * requires TODAY. Enforcement migrates here kind by kind — adding a future
 * pendency means adding a row, never a new strategy.
 *
 * Writers: "host" (the plugin commits the transition itself, e.g. stages),
 * "worker-propose/host-commit" (the worker proposes with evidence, the host
 * validates and commits, e.g. scopes), "worker" (legacy self-report, being
 * phased out behind host verification).
 *
 * Artifacts name the uniform file layout per kind (areas under the state
 * dir owned by lib/tracking-paths.mjs): a kind without its own files keeps
 * evidence inline in tracking, never in a third location.
 *
 * ContractFile/recordInline drive the generic evidence reader
 * (lib/trackable-evidence.mjs): `{id}` fills with the trackable id.
 * A null contractFile means the kind carries no sidecar file — conditions
 * that need one stay silent for it instead of warning on every row.
 */

export const TRACKABLE_CONTRACTS = [
  {
    kind: "stage",
    ref: "skills/stelow-workflow-orchestrator/references/transitions.md",
    writer: "host",
    doneWhen: ["legal advance transition recorded by the host"],
    contractFile: null,
    recordInline: null,
    artifacts: ["<stateDir>/state.md (human mirror)", "stelow.json#workflows (machine desired)"],
  },
  {
    kind: "scope",
    contractFile: "scopes/{id}.json",
    recordInline: "record",
    ref: "skills/stelow-workflow-scope-executor/references/records-and-tasks.md",
    writer: "worker-propose/host-commit",
    doneWhen: ["Record complete (files, commands, baseline)", "record.verified === true", "no blocking overlap (Step 8 report)"],
    artifacts: ["<stateDir>/scopes/{scope-id}.json (contract)", "stelow.json#workflows[].scopes[] (desired + record mirror)"],
  },
  {
    kind: "task",
    contractFile: null,
    recordInline: null,
    ref: "skills/stelow-workflow-scope-executor/references/records-and-tasks.md",
    writer: "worker-propose/host-commit",
    doneWhen: ["executor marks done (planned) with trigger note (discovered)"],
    artifacts: ["stelow.json#workflows[].scopes[].tasks[] (inline checklist)"],
  },
  {
    kind: "acceptance-criterion",
    contractFile: "scopes/{parentId}.json",
    recordInline: null,
    ref: "skills/stelow-workflow-scope-executor/references/cli-tools/subagents.md",
    writer: "worker-propose/host-commit",
    doneWhen: ["cited in scope-contract.json acceptance_criteria", "verify_commands pass", "mirrored in audit.md acceptance section"],
    artifacts: ["<stateDir>/scopes/{scope-id}.json#acceptance_criteria", "<stateDir>/audit.md (acceptance section)"],
  },
  {
    kind: "gap",
    contractFile: null,
    recordInline: null,
    ref: "skills/stelow-workflow-execution-critique/SKILL.md",
    writer: "worker-propose/host-commit",
    doneWhen: ["fixed inline, documented, or linked to an audit-gap scope that is done"],
    artifacts: ["execution critique report (registered artifact)", "stelow.json#workflows[].scopes[] (audit-gap rework)"],
  },
  {
    kind: "question",
    contractFile: null,
    recordInline: null,
    ref: "lib/ask-contracts.mjs",
    writer: "host",
    doneWhen: ["recorded answer or required receipt"],
    artifacts: ["SQLite inbox_events (durable)", "<stateDir>/*-receipt.md (stage receipts)"],
  },
  {
    kind: "review",
    contractFile: null,
    recordInline: null,
    ref: "lib/review-gates.mjs",
    writer: "host",
    doneWhen: ["passing review covering the current fingerprint"],
    artifacts: ["<stateDir>/reviews/*.md (verdict files)"],
  },
  {
    kind: "verification",
    contractFile: null,
    recordInline: null,
    ref: "lib/audit-verification.mjs",
    writer: "host",
    doneWhen: ["host-run test command at the verified Git root and HEAD"],
    artifacts: ["SQLite verification_runs (durable)", "<stateDir>/audit.md (tests section)"],
  },
];

/** Evidence contract for a trackable kind, or null when unmigrated. */
export function contractForTrackable(kind) {
  if (typeof kind !== "string" || !kind) return null;
  return TRACKABLE_CONTRACTS.find((entry) => entry.kind === kind) ?? null;
}
