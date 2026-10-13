export declare function readOpenExpiredQuestions(
  deps: {
    db: { prepare(query: string): { all(...values: unknown[]): Array<Record<string, unknown>> } };
    resolveAskOptions: (card: any, options: any) => Promise<any>;
  },
  card: { id: string; status: string },
): Promise<Array<{ id: string; question: string; multiple: boolean; kind: string; options: unknown; expiredAt: number }>>;
