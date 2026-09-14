export declare function questionOpenGuard(counts: {
  liveInteractions: number;
  expiredQuestions: number;
}): {
  canOpen: boolean;
  reason: string | null;
};
