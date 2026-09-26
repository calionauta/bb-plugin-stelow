/**
 * The prompt the workflow thread is spawned with.
 *
 * A free-text request enters the plugin through exactly one prompt, so the
 * routing instruction, the gate list, and the request itself are stated once
 * here instead of being reassembled at each spawn site.
 */
import { CLI_EQUIVALENTS } from "./plugin-protocols.js";

export function startWorkflowPrompt(request: string): string {
  return `Use the stelow workflow to shape and execute this request. The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, \
stelow-workflow-*) are provided by bb-plugin-stelow — load them first. The product strategy playbooks (stelow-product-*) are also provided by \
this plugin — check \`bb skill list\` first, and only fetch via \`npx skills add calionauta/stelow\` if one is missing. Use \`bb stelow \
advance <stage>\` to change stages; do NOT hand-write stage transitions. Preserve every gate \
(product, interface, tech plan, diff). ${CLI_EQUIVALENTS}\n\nRequest:\n${request}`;
}
