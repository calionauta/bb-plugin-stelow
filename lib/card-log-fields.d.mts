export declare const CARD_LOG_FIELDS: ReadonlySet<string>;
export declare const CARD_LOG_IGNORED: Readonly<Record<string, string>>;
export declare function isLoggedCardField(key: unknown): boolean;
export declare function unclassifiedCardFields(columns: unknown): string[];
