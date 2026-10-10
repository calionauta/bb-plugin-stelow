export declare function scopeTitleIndex(entries: unknown): Map<string, string>;
export declare function replaceScopeIds(text: string, index: Map<string, string>): string;
export declare function applyScopeLabels<T>(question: T, index: Map<string, string>): T;
export declare function labelDetailQuestions(
  pending: unknown,
  expired: unknown,
  xray: unknown,
  draft: unknown,
  scopes: unknown,
  // any: the spread lands in the detail assembly typed Question[] — the
  // copies keep every key they were given, so the shape is the input shape.
): { pending: any; expired: any };
