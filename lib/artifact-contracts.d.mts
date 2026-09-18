// Type declarations for lib/artifact-contracts.mjs

export interface ArtifactCheck {
  kind: "min-words" | "headings" | "named-headings" | "contains" | "section-items" | "field-blocks" | "table-rows";
  [key: string]: unknown;
}

export interface ArtifactContract {
  slug: string;
  ref: string;
  minWords?: number;
  checks: ArtifactCheck[];
}

export declare const JTBD_CONTRACTS: ArtifactContract[];
export declare function contractForSubstep(slug: unknown): ArtifactContract | null;
