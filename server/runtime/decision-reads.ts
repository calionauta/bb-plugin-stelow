/**
 * Serving past decisions at the point of work. A worker starting execution on
 * scopes receives the decision receipts covering those scopes as a `reads:`
 * block — alongside the spec and the map, not behind a lookup it must know
 * to perform. No loading here: callers pass already-loaded receipts (the
 * approvals-dir reader owns that), so this stays pure composition over
 * `lib/decision-coverage.mjs` and unit-testable without I/O.
 */
import {
  capReads,
  formatDecisionReads,
  receiptsForScopes,
} from "../../lib/decision-coverage.mjs";

export type DecisionReceiptInput = {
  id: string;
  kind?: string;
  scopeIds?: string[];
};

/** The served block, or "" when no receipt covers the scopes. Additive: no receipts, no text. */
export function decisionReadsBlock(receipts: DecisionReceiptInput[] | null | undefined, scopeIds: string[]): string {
  const selected = receiptsForScopes(receipts ?? [], scopeIds ?? []);
  const { served, omittedIds } = capReads(selected);
  return formatDecisionReads(served, omittedIds);
}

/** Append the block to a worker prompt. Identity when the block is empty. */
export function promptWithDecisionReads(prompt: string, block: string): string {
  if (!block) return prompt;
  return `${prompt}\n\n${block}`;
}
