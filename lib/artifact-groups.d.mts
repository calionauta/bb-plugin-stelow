export declare const STAGE_SEQUENCE: string[];
export declare type ArtifactFile = { stage: string; kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string };
export declare type GroupedArtifacts = { stage: string; items: ArtifactFile[] };
export declare function groupArtifactsByStage(artifacts: unknown): GroupedArtifacts[];
export declare type ResearchArtifactFile = { display: string; path: string; absolutePath: string; hostId: string; generatedAt: string; kind: string; note: string | null };
export declare type ResearchArtifactGroup = { id: string; title: string; items: ResearchArtifactFile[] };
export declare function groupResearchArtifacts(rounds: unknown, outputs: unknown): ResearchArtifactGroup[];
