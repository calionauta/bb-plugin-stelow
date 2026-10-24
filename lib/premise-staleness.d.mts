import type { ContrastModel } from "./contrast-model.mjs";

export type PremiseCellRef = {
  kind: "cell";
  place: string;
  state: string;
  /** Present only for a `place|state|affordance` premise. */
  affordance: string | null;
  raw: string;
};
export type PremiseArtifactRef = {
  kind: "artifact";
  /** Workspace-relative path, as an editor would show it. */
  path: string;
  /** 1-based line number. */
  line: number;
  raw: string;
};
export type PremiseRef = PremiseCellRef | PremiseArtifactRef;
export type ReversalCost = { level: "low" | "medium" | "high"; why: string };
export type PremiseVerdict = { stale: boolean; missing: string[]; checked: number } | null;
export type PremiseObserver = (ref: PremiseRef) => boolean | null | undefined;

/** Every ref a premise names. Throws naming the premise when one is unreadable. */
export declare function premiseRefs(premise: unknown): PremiseRef[];
/** True when the string is a premise this module can read back to a coordinate. */
export declare function isPremise(premise: unknown): boolean;
/** A named cost level plus the one sentence that says why. */
export declare function isReversalCost(cost: unknown): cost is ReversalCost;
/** `null` means nothing could be observed — never "not stale". */
export declare function premiseVerdict(premise: unknown, observe: PremiseObserver): PremiseVerdict;
/** Attach a derived verdict to each recorded row; a legacy row has no premise. */
export declare function stalenessOfAnswered<T extends { premise?: string | null }>(
  rows: T[] | null | undefined,
  observe: PremiseObserver,
): Array<T & { verdict: PremiseVerdict }>;
/** The trail sentence for a stale answer, or null when the verdict is not stale. */
export declare function staleTrailLine(verdict: PremiseVerdict): string | null;
export declare function cellObserver(model: ContrastModel | null): PremiseObserver;
export declare function artifactObserver(read: (path: string) => string): PremiseObserver;
export declare function observeFromCard(input?: {
  stateDir?: string | null;
  readText?: (path: string) => string;
}): PremiseObserver;
