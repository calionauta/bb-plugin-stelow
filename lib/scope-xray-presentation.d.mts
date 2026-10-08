import type { ScopeXrayView } from "../components/detail/scope-xray.js";

export type XrayNodeState = { label: string; tone: "muted" | "warn" } | null;

export type ScopeXrayPresentation = {
  mapId: string;
  mapVersion: string;
  scopeCount: number;
  freshness: { label: string; tone: "muted" | "warn"; note: string; appliesToAll: boolean };
  /** Header-level decisions sentence; null when the card holds no receipts. */
  decisions: string | null;
  nodes: Array<{
    id: string;
    title: string;
    capabilities: string[];
    state: XrayNodeState;
  }>;
  dependencies: Array<{ from: string; to: string }>;
};

/** Null when there is no X-ray to draw. */
export declare function scopeXrayPresentation(
  xray: ScopeXrayView | null | undefined,
): ScopeXrayPresentation | null;

/**
 * Why the card has no tracked scopes, or null when it has some.
 *
 * Keyed on whether an approved MAP exists, which is a different question from
 * whether the tracker is populated — the two are written at different stages by
 * different writers, and conflating them is what made the card say "no scopes
 * broken down yet" directly under a list of seven.
 */
export declare function scopeEmptyState(input: {
  hasMap: boolean;
  tracked: number;
  cardStatus: string;
  archived: string | undefined;
}): string | null;
