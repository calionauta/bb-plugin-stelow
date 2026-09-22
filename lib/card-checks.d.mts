export interface CardCheckGroup {
  id: string;
  label: string;
  open: string[];
  doneCount: number;
  total: number;
}
export declare function groupCardChecks(options: {
  questions?: Array<{ title?: string; question?: string } | null> | null;
  scopes?: Array<{ id?: string; name?: string; status?: string; tasks?: Array<{ name?: string; status?: string }> | null } | null> | null;
  gaps?: { matched?: boolean; items?: Array<{ description?: string }> | null; fixed?: number; documented?: number; total?: number } | null;
  review?: { pending?: boolean; done?: boolean } | null;
}): CardCheckGroup[];
export declare function groupState(group: unknown): "done" | "pending" | "empty";
export declare function isExecutionUntracked(options: {
  activity?: string | null;
  scopes?: Array<{ status?: string } | null> | null;
}): boolean;
export declare function isScopeTrackingMissing(options: {
  activity?: string | null;
  stage?: string | null;
  scopes?: Array<{ status?: string } | null> | null;
}): boolean;
