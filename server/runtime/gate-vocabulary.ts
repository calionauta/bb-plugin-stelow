/**
 * The gate vocabulary: which artifact a gate reviews and which receipt file
 * proves it was approved.
 *
 * One table, because the board shows a workflow as "approved" and the gate
 * handler writes "approved" from the same pair of names. A copy in either
 * place would let the panel mark a gate approved from a receipt the handler
 * no longer writes.
 */
export const GATES = {
  gate: { artifact: "product-spec", receipt: "gate-approved.md" },
  "int-gate": { artifact: "interfaces", receipt: "int-gate-approved.md" },
  "plan-gate": { artifact: "tech-plan", receipt: "plan-gate-approved.md" },
  "diff-gate": { artifact: "other", receipt: "diff-gate-approved.md" },
} as const;

export type Gate = keyof typeof GATES;
export type GateSpec = (typeof GATES)[Gate];

/** The receipt a gate leaves behind, or "" for a kind no gate approves. */
export function gateReceiptFor(
  kind: GateSpec["artifact"] | "critique" | "other",
): string {
  if (kind === "product-spec") return GATES.gate.receipt;
  if (kind === "interfaces") return GATES["int-gate"].receipt;
  if (kind === "tech-plan") return GATES["plan-gate"].receipt;
  return "";
}
