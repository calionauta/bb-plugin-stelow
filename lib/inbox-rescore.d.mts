export const OPEN_ROW_COLUMNS: string;
export function rescoreOpenRows(db: { prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number } } }, rows: readonly unknown[], nowMs: number): number;
