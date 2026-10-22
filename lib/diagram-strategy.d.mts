export declare const PELE_PIN: string;
export declare const PELE_REPO: string;
export declare const PELE_HOMEPAGE: string;
export declare const PELE_PLAYGROUND: string;
export declare const PELE_INSTALL: string;
export interface DiagramRecommendation {
  kinds: string[];
  source: string;
  derived: boolean;
}
export declare function diagramForArtifact(path: unknown): DiagramRecommendation | null;
export declare function isDiagrammable(path: unknown): boolean;
export declare function pelePlaygroundUrl(source: unknown): string;
