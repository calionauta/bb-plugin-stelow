/** Frozen technical acceptance badge mapping (components/detail/frozen-acceptance-row.mjs). */

export declare function frozenBadgeFor(entry: {
  test?: unknown;
  frozen?: unknown;
  redProof?: unknown;
} | null | undefined): { tone: "red" | "green" | "missing"; glyph: string; label: string };

export declare function isFrozenStale(input?: {
  freezeSha?: unknown;
  currentHeadSha?: unknown;
}): boolean;
