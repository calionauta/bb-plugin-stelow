import { STAGE_SEQUENCE } from "./workflow-vocabulary.mjs";

/** Canonical state.md scaffold, derived from the shared workflow vocabulary. */
const STAGES_BLOCK = STAGE_SEQUENCE.map((stage) => `  ${stage}: pending`).join("\n");
export const STATE_TEMPLATE =
  `---\nworkflow_id: <workflow-id>\nname: <workflow-name>\n` +
  `intent: <new-product|feature|bugfix|refactor|investigate|unknown>\n` +
  `current_stage: triage\nstatus: active\nconfig:\n` +
  `  quality: production\n  supervisor: high\n` +
  `  exploration_count: 3\n  exploration_hybrid: true\n` +
  `  review_mode: Auto\n  product_type: software\n` +
  `stages:\n${STAGES_BLOCK}\nartifacts: []\nhistory: []\n---\n`;

/** Stage slugs in canonical order, parsed from the template (not duplicated). */
export function templateStages() {
  const block = STATE_TEMPLATE.split("stages:\n")[1] ?? "";
  return [...block.matchAll(/^  ([a-z][a-z0-9-]*): pending$/gm)].map((m) => m[1]);
}
