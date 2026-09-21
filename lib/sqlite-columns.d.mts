export function ensureColumns(
  db: {
    prepare(sql: string): { all(): unknown[] };
    exec(sql: string): unknown;
  },
  table: string,
  specs: Array<[string, string]>,
): void;
