export declare const CLAUSE_CHAR_CEILINGS: Readonly<Record<string, number>>;
export declare const PATH_CLAUSE_OBLIGATIONS: Readonly<Record<string,
  "all" | { only: string[] } | { omit: string[] }>>;
export declare const CLAUSE_PROTOCOL_KEYS: Readonly<Record<string, string>>;
/** Whether `path` owes `clause`, given either the CONST name or the protocol key. */
export declare function pathOwesClause(path: string, clause: string): boolean;
