// Type declarations for lib/jtbd-contracts.mjs
import type { ArtifactContract } from "./artifact-contracts.mjs";

export declare const JTBD_CONTRACTS: ArtifactContract[];
export declare const JTBD_SUBSTEPS: import("./stelow-jtbd-contracts.mjs").StelowSubstep[];
export declare function contractForSubstep(slug: unknown): ArtifactContract | null;
