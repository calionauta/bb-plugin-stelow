/**
 * Canonical state.md scaffold for a fresh workflow. Single source of truth:
 * server seedWorkflow and the workflow-contracts test both read this —
 * never duplicate the stage list elsewhere.
 */
export const STATE_TEMPLATE = `---\nname: <workflow-name>\nintent: <new-product|feature|bugfix|refactor|investigate|unknown>\ncurrent_stage: triage\nstatus: active\nconfig:\n  appetite: Core\n  review_mode: Auto\n  product_type: software\nstages:\n  triage: pending\n  select: pending\n  setup: pending\n  context: pending\n  shape: pending\n  critique: pending\n  gate: pending\n  scope: pending\n  interface: pending\n  int-gate: pending\n  selection: pending\n  planning: pending\n  plan-gate: pending\n  execution: pending\n  verification: pending\n  diff-gate: pending\n  audit: pending\nartifacts: []\nhistory: []\n---\n`;

/** Stage slugs in canonical order, parsed from the template (not duplicated). */
export function templateStages() {
  const block = STATE_TEMPLATE.split("stages:\n")[1] ?? "";
  return [...block.matchAll(/^  ([a-z][a-z0-9-]*): pending$/gm)].map((m) => m[1]);
}
