import type { ContrastModel, ContrastQuestion, ReversalCostLevel } from "./contrast-model.mjs";

/** The artifact's fixed name inside the card's state dir. */
export declare const CONTRAST_ARTIFACT: string;
/** The fence language the matrix lives in. */
export declare const CONTRAST_FENCE: string;

/** One derived question as the fields a recorded ask carries. */
export interface ContrastAskDeclaration {
  question: string;
  /** `place|state` (or `place|state|affordance`), `+`-joined when derived from several cells. */
  premise: string;
  reversalCost: { level: ReversalCostLevel; why: string };
  options: Array<{ id: string; label: string }>;
}

export declare function renderContrastArtifact(model: ContrastModel): string;
export declare function contrastMatrixFence(markdown: unknown): string | null;
export declare function parseContrastArtifact(markdown: unknown): ContrastModel;
export declare function contrastArtifactQuestions(markdown: unknown): ContrastQuestion[];
export declare function contrastAskDeclarations(markdown: unknown): ContrastAskDeclaration[];
