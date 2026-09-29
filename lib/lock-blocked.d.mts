export type LockBlock = {
  cardId: string;
  file: string;
  holderCardId: string;
  holderName: string;
  expiresAt: number;
};

export declare function lockBlockSummary(block: LockBlock): string;
export declare function lockBlockDedupeKey(block: Pick<LockBlock, "cardId" | "file">): string;
export declare function lockBlockEvent(block: LockBlock): {
  summary: string;
  dedupeKey: string;
  holderCardId: string;
  holderFile: string;
};

export type BlockedFileWait = {
  files: string[];
  /** Foreign holder card ids. Empty when `internal` — the holder is a sibling
   * scope of this same card, which a reader cannot go and unblock. */
  holders: string[];
  holderCardId: string;
  holderName: string;
  /** True when the holder is another scope of this card rather than another card. */
  internal: boolean;
  expiresAt: number;
};

export declare function blockedFileWait(
  scopes: Array<{ blockedFiles?: Array<{ file?: string; heldBy?: string; holderLabel?: string | null; expiresAt?: number }> | null } | null> | null,
  resolveHolderName: (holderCardId: string) => string,
): BlockedFileWait | null;

export declare function lockWaitCopy(wait: BlockedFileWait | null): string | null;

export type HeroState = { kind: "paused"; title: string; sub: string };

export declare function lockWaitHero(wait: BlockedFileWait | null): HeroState | null;

export type ScopeClaimTone = "held" | "blocked" | "missing";

export type ScopeClaimRow = {
  tone: ScopeClaimTone;
  text: string;
  title: string;
};

export declare function scopeClaimLines(scope?: {
  claimFiles?: string[] | null;
  blockedFiles?: Array<{ file?: string; heldBy?: string } | null> | null;
  claimed?: boolean | null;
  status?: string | null;
} | null): ScopeClaimRow[];