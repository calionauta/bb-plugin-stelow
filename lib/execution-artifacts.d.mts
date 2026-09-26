export function safeArtifactPath(value: unknown): boolean;
export function requiredOutputPaths(recipe: Record<string, any>, context?: Record<string, unknown>): string[];
export function validateExecutionArtifacts(options: { recipe: Record<string, any>; contents: Record<string, string>; context?: Record<string, unknown> }): { ok: boolean; missing: string[]; malformed: string[]; issues: string[]; paths: string[] };
export function executionArtifactManifest(options: { run: Record<string, any>; recipe: Record<string, any>; contents: Record<string, string> }): Record<string, any>;
