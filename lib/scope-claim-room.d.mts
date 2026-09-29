import type { ClaimRoom } from "./card-claims.mjs";

export type BlockedFile = {
  file: string;
  heldBy: string;
  heldScope: string | null;
  /** Set when the holder is a sibling scope of the same card, so the card can
   * say "another scope on this card" instead of naming its own card. */
  holderLabel: string | null;
  expiresAt: number;
};

export declare function rowIsOwnScopeClaim(
  row: unknown,
  args: { ownerId?: string; scopeId?: string; targets?: string[] },
): boolean;

export declare function scopeClaimRoom(rows: unknown, args?: {
  ownerId?: string;
  scopeId?: string;
  files?: string[];
  nowMs?: number;
}): { held: ClaimRoom["held"]; blocked: BlockedFile[] };

export declare function matchScopeClaims(rows: unknown, args?: {
  ownerId?: string;
  scopeId?: string;
  files?: string[];
  nowMs?: number;
}): Array<{ file_path: string; card_id: string; scope: string | null; expires_at: number }>;
