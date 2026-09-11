export declare type ArchivedCard = {
  status?: string | null;
  stage: string;
} | null | undefined;

export declare function archivedCardDetailPresentation(card: ArchivedCard, stageLabel: (stage: string) => string): {
  hero: {
    kind: "calm";
    title: string;
    sub: string;
  };
  workflow: {
    title: string;
    hint: string;
    emptyScopes: string;
    progressTitle: string;
    progressHint: string;
  };
} | null;
