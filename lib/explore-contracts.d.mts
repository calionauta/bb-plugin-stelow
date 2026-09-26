// Type declarations for lib/explore-contracts.mjs
import type { ExploreContract } from "./artifact-contracts.mjs";

export declare const EXPLORE_CONTRACTS: ExploreContract[];
export declare function contractForExplore(stageId: unknown): ExploreContract | null;
export declare function contractForBuildArtifact(filePath: unknown, content: unknown): ExploreContract | null;
