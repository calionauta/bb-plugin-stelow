/**
 * The prompt the workflow thread is spawned with.
 *
 * A free-text request enters the plugin through exactly one prompt, so the
 * routing instruction, the gate list, and the request itself are stated once
 * here instead of being reassembled at each spawn site.
 */
import { CLI_EQUIVALENTS } from "./plugin-protocols.js";

export function startWorkflowPrompt(request: string): string {
  return `Use the stelow workflow to shape and execute this request. Read \`bb stelow playbook\` and load exactly the skills it \
names, in the order it lists them — it is the whole reading list, and it resolves the plugin's skill paths. Do not search for skills \
and do not fetch anything via \`npx skills add\` unless the playbook reports a path missing. Use \`bb stelow \
advance <stage>\` to change stages; do NOT hand-write stage transitions. Preserve every gate \
(product, interface, tech plan, diff). ${CLI_EQUIVALENTS}\n\nRequest:\n${request}`;
}
