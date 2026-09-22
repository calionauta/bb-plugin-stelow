export interface ParsedScopeArgs {
  op?: string;
  scopeId?: string;
  passthrough?: string[];
  projectId?: string | null;
  error?: string;
}
export declare function parseScopeArgs(argv: unknown): ParsedScopeArgs;
export declare function scopeCommandUsage(): string;
