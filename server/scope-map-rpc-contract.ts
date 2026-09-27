import { z } from "zod";

/**
 * Approving a card's scope map.
 *
 * The one door that makes a scope map "approved" on the host. The worker writes
 * a draft through the scope recipe; this stamps it, mirrors the Shape version
 * into state.md, and records a trail comment. Content-free by design — the
 * approver is whoever calls, so the input is only the card.
 */
export const scopeMapApprovalInputSchema = z
  .object({
    cardId: z.string(),
  })
  .strict();

export const scopeMapApprovalOutputSchema = z.union([
  z.object({
    ok: z.literal(true),
    receiptId: z.string(),
    approvedBy: z.string(),
    mapId: z.string(),
    shapeVersion: z.string(),
    scopeIds: z.array(z.string()),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
  }),
]);

export const scopeMapApprovalContract = {
  approveScopeMap: {
    experimental_description:
      "Approve a card's scope map on the host (the only writer of an approved map)",
    input: scopeMapApprovalInputSchema,
    output: scopeMapApprovalOutputSchema,
  },
};
