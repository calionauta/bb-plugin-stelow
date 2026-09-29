import type { ClaimRoom } from "./card-claims.mjs";

export declare function scopeClaimRoom(rows: unknown, args?: {
  ownerId?: string;
  scopeId?: string;
  files?: string[];
  nowMs?: number;
}): ClaimRoom;

export declare function matchScopeClaims(rows: unknown, args?: {
  ownerId?: string;
  scopeId?: string;
  files?: string[];
  nowMs?: number;
}): Array<{ file_path: string; card_id: string; scope: string | null; expires_at: number }>;
