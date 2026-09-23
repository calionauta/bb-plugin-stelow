type EntitySummary = { total: number; fileCount: number; added: number; modified: number; deleted: number; renamed: number; moved: number; cosmeticOnly: boolean };
type ChangedSymbol = { symbol: string; files: string[]; callers: number; testCallers: number };
export function formatEntitySummary(summary: EntitySummary | null): string | null;
export function formatChangedSymbols(symbols: ChangedSymbol[] | null): string | null;
