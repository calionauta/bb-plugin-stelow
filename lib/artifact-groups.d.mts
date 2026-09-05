export declare const STAGE_SEQUENCE: string[];
export declare type ArtifactFile = { stage: string; kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string };
export declare type GroupedArtifacts = { stage: string; items: ArtifactFile[] };
export declare function groupArtifactsByStage(artifacts: unknown): GroupedArtifacts[];
