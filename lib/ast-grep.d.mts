export interface AstGrepMatch {
  file: string;
  startLine: number | null;
  endLine: number | null;
  text: string;
}

export declare function summarizeAstGrepMatches(json: unknown, max?: number): AstGrepMatch[] | null;
