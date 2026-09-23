type EntitySummary = { total: number; fileCount: number; added: number; modified: number; deleted: number; renamed: number; moved: number; cosmeticOnly: boolean };
type ChangedSymbol = { symbol: string; files: string[]; callers: number; testCallers: number };
type BuildDiffVisibility = { status: string; stage: string; publicationDirty: boolean; recoveryKind: string | null };
export function shouldShowBuildDiff(input: BuildDiffVisibility): boolean;
export function formatEntitySummary(summary: EntitySummary | null): string | null;
export function formatChangedSymbols(symbols: ChangedSymbol[] | null): string | null;
